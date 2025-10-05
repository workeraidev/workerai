import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { DurableObject } from 'cloudflare:workers';
import { sign, verify } from 'hono/jwt';

interface Env {
  AI_CHAT_DB: D1Database;
  CHAT_SESSIONS: KVNamespace;
  FILE_STORAGE: R2Bucket;
  CHAT_DO: DurableObjectNamespace;
  MYBROWSER: Fetcher;
  ANALYTICS: AnalyticsEngineDataset;
  GEMINI_API_KEY: string;
  JWT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// CORS with credentials
app.use('/*', cors({
  origin: (origin) => origin,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting middleware
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

app.use('/api/*', async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const limit = rateLimiter.get(ip);
  
  if (limit && limit.resetAt > now) {
    if (limit.count >= 100) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    limit.count++;
  } else {
    rateLimiter.set(ip, { count: 1, resetAt: now + 60000 });
  }
  
  await next();
});

// Auth middleware
app.use('/api/protected/*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const token = authHeader.substring(7);
    const payload = await verify(token, c.env.JWT_SECRET);
    c.set('userId', payload.sub as string);
    await next();
  } catch (error) {
    return c.json({ error: 'Invalid token' }, 401);
  }
});

// ============ AUTH ENDPOINTS ============

// GitHub OAuth
app.get('/api/auth/github', (c) => {
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/github/callback`;
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${c.env.GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}&scope=user:email`;
  return c.redirect(githubAuthUrl);
});

app.get('/api/auth/github/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'No code provided' }, 400);

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const { access_token } = await tokenResponse.json();

    // Get user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const githubUser = await userResponse.json();

    // Get user email
    const emailResponse = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const emails = await emailResponse.json();
    const primaryEmail = emails.find((e: any) => e.primary)?.email;

    // Create or update user
    const userId = `github-${githubUser.id}`;
    await c.env.AI_CHAT_DB.prepare(
      `INSERT INTO users (id, email, name, avatar_url, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?) 
       ON CONFLICT(id) DO UPDATE SET 
       email=excluded.email, name=excluded.name, avatar_url=excluded.avatar_url, updated_at=excluded.updated_at`
    ).bind(
      userId,
      primaryEmail,
      githubUser.name || githubUser.login,
      githubUser.avatar_url,
      Date.now(),
      Date.now()
    ).run();

    // Generate JWT
    const token = await sign(
      { sub: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 },
      c.env.JWT_SECRET
    );

    // Redirect to frontend with token
    return c.redirect(`/?token=${token}`);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Google OAuth
app.get('/api/auth/google', (c) => {
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;
  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${c.env.GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=openid email profile`;
  return c.redirect(googleAuthUrl);
});

app.get('/api/auth/google/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'No code provided' }, 400);

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${new URL(c.req.url).origin}/api/auth/google/callback`,
      }),
    });

    const { access_token } = await tokenResponse.json();

    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const googleUser = await userResponse.json();

    const userId = `google-${googleUser.id}`;
    await c.env.AI_CHAT_DB.prepare(
      `INSERT INTO users (id, email, name, avatar_url, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?) 
       ON CONFLICT(id) DO UPDATE SET 
       email=excluded.email, name=excluded.name, avatar_url=excluded.avatar_url, updated_at=excluded.updated_at`
    ).bind(
      userId,
      googleUser.email,
      googleUser.name,
      googleUser.picture,
      Date.now(),
      Date.now()
    ).run();

    const token = await sign(
      { sub: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 },
      c.env.JWT_SECRET
    );

    return c.redirect(`/?token=${token}`);
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Get current user
app.get('/api/auth/me', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Not authenticated' }, 401);

  const { results } = await c.env.AI_CHAT_DB.prepare(
    'SELECT id, email, name, avatar_url FROM users WHERE id = ?'
  ).bind(userId).all();

  return c.json({ user: results[0] || null });
});

// Logout (client-side token removal)
app.post('/api/auth/logout', (c) => {
  return c.json({ success: true });
});

// ============ CHAT ENDPOINTS ============

app.post('/api/protected/chat/completions', async (c) => {
  const userId = c.get('userId');
  const { messages, model = 'gemini-2.0-flash-thinking-exp-01-21', sessionId } = await c.req.json();

  // Save message to database
  if (sessionId) {
    const userMsg = messages[messages.length - 1];
    await c.env.AI_CHAT_DB.prepare(
      'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), sessionId, userMsg.role, userMsg.content, Date.now()).run();
  }

  // Track analytics
  c.env.ANALYTICS.writeDataPoint({
    blobs: ['chat_completion', userId, model],
    doubles: [Date.now()],
    indexes: [sessionId || userId]
  });

  return streamSSE(c, async (stream) => {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${c.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: messages.map((msg: any) => ({
              role: msg.role === 'user' ? 'user' : 'model',
              parts: [{ text: msg.content }]
            })),
            generationConfig: {
              temperature: 0.9,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 8192,
            },
            tools: [
              { googleSearch: {} },
              { codeExecution: {} }
            ]
          })
        }
      );

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() && line.startsWith('data: ')) {
            const data = line.slice(6);
            await stream.writeSSE({ data });
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
                fullResponse += parsed.candidates[0].content.parts[0].text;
              }
            } catch {}
          }
        }
      }

      // Save assistant response
      if (sessionId && fullResponse) {
        await c.env.AI_CHAT_DB.prepare(
          'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(crypto.randomUUID(), sessionId, 'assistant', fullResponse, Date.now()).run();
        
        // Update session timestamp
        await c.env.AI_CHAT_DB.prepare(
          'UPDATE sessions SET updated_at = ? WHERE id = ?'
        ).bind(Date.now(), sessionId).run();
      }

    } catch (error: any) {
      await stream.writeSSE({ data: JSON.stringify({ error: error.message }) });
    }
  });
});

// ============ SESSION MANAGEMENT ============

app.post('/api/protected/sessions', async (c) => {
  const userId = c.get('userId');
  const { title = 'New Chat' } = await c.req.json();
  const sessionId = crypto.randomUUID();

  await c.env.AI_CHAT_DB.prepare(
    'INSERT INTO sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, title, Date.now(), Date.now()).run();

  return c.json({ sessionId, title });
});

app.get('/api/protected/sessions', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.AI_CHAT_DB.prepare(
    'SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50'
  ).bind(userId).all();

  return c.json({ sessions: results });
});

app.get('/api/protected/sessions/:id', async (c) => {
  const userId = c.get('userId');
  const sessionId = c.req.param('id');

  const { results: sessionResults } = await c.env.AI_CHAT_DB.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).bind(sessionId, userId).all();

  if (!sessionResults.length) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const { results: messages } = await c.env.AI_CHAT_DB.prepare(
    'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).bind(sessionId).all();

  return c.json({ session: sessionResults[0], messages });
});

app.delete('/api/protected/sessions/:id', async (c) => {
  const userId = c.get('userId');
  const sessionId = c.req.param('id');

  await c.env.AI_CHAT_DB.prepare(
    'DELETE FROM sessions WHERE id = ? AND user_id = ?'
  ).bind(sessionId, userId).run();

  await c.env.AI_CHAT_DB.prepare(
    'DELETE FROM messages WHERE session_id = ?'
  ).bind(sessionId).run();

  return c.json({ success: true });
});

app.put('/api/protected/sessions/:id', async (c) => {
  const userId = c.get('userId');
  const sessionId = c.req.param('id');
  const { title } = await c.req.json();

  await c.env.AI_CHAT_DB.prepare(
    'UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?'
  ).bind(title, Date.now(), sessionId, userId).run();

  return c.json({ success: true });
});

// ============ FILE OPERATIONS ============

app.post('/api/protected/files/upload', async (c) => {
  const userId = c.get('userId');
  const formData = await c.req.formData();
  const file = formData.get('file') as File;

  if (!file) return c.json({ error: 'No file' }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'File too large' }, 400);

  const key = `${userId}/${Date.now()}-${file.name}`;
  await c.env.FILE_STORAGE.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { userId, originalName: file.name }
  });

  const fileId = crypto.randomUUID();
  await c.env.AI_CHAT_DB.prepare(
    'INSERT INTO files (id, user_id, filename, mime_type, size, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(fileId, userId, file.name, file.type, file.size, key, Date.now()).run();

  return c.json({ fileId, url: `/api/files/${key}`, name: file.name, type: file.type });
});

app.get('/api/files/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.FILE_STORAGE.get(key);

  if (!object) return c.notFound();

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000',
    }
  });
});

// ============ IMAGE GENERATION ============

app.post('/api/protected/generate/image', async (c) => {
  const userId = c.get('userId');
  const { prompt } = await c.req.json();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:generateImages?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, numberOfImages: 1, aspectRatio: '1:1' })
    }
  );

  const data = await response.json();

  if (data.generatedImages?.[0]) {
    const imageBase64 = data.generatedImages[0].imageData;
    const imageBuffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
    const key = `${userId}/images/${Date.now()}.png`;

    await c.env.FILE_STORAGE.put(key, imageBuffer, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { userId, prompt }
    });

    return c.json({ imageUrl: `/api/files/${key}`, key });
  }

  return c.json({ error: 'Generation failed' }, 500);
});

// ============ WEBSOCKET CHAT ============

app.get('/api/chat/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 426);
  }

  const userId = c.req.query('userId');
  const sessionId = c.req.query('sessionId') || crypto.randomUUID();

  const id = c.env.CHAT_DO.idFromName(sessionId);
  const stub = c.env.CHAT_DO.get(id);

  return stub.fetch(c.req.raw);
});

export default app;

// ============ DURABLE OBJECT ============

export class ChatDurableObject extends DurableObject {
  sessions: Map<WebSocket, { userId: string; sessionId: string }>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') || 'anonymous';
    const sessionId = url.searchParams.get('sessionId') || crypto.randomUUID();

    this.sessions.set(server, { userId, sessionId });

    server.addEventListener('message', async (event) => {
      const data = JSON.parse(event.data.toString());
      
      this.sessions.forEach((s, socket) => {
        if (s.sessionId === sessionId) {
          socket.send(JSON.stringify({
            type: 'message',
            ...data,
            timestamp: Date.now()
          }));
        }
      });
    });

    server.addEventListener('close', () => {
      this.sessions.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}
