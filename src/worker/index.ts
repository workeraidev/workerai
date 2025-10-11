import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import puppeteer from '@cloudflare/puppeteer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { runWithTools, tool } from '@cloudflare/ai-utils';

type Env = {
  AI: Ai;
  MYBROWSER: any;
  ANALYTICS: AnalyticsEngineDataset;
  CHAT_SESSIONS: KVNamespace;
  FILE_STORAGE: R2Bucket;
  CHAT_DO: DurableObjectNamespace;
  AI_CHAT_DB: D1Database;
  GOOGLE_AI_STUDIO_TOKEN: string;
  DEEPGRAM_API_KEY: string;
  AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-User-Id'],
}));

// ==================== SYSTEM PROMPT ====================
const SYSTEM_PROMPT = `You are an expert Cloudflare Workers AI Code Agent specialized in writing, debugging, and deploying Cloudflare Workers code.

Your capabilities:
1. Write production-ready Cloudflare Workers code with TypeScript
2. Use Cloudflare bindings (AI, D1, KV, R2, Browser Rendering, Workflows, Analytics)
3. Implement AI features using Workers AI models
4. Create RESTful APIs and WebSocket connections
5. Take screenshots and analyze web pages
6. Generate images with AI models
7. Search the web for current information
8. Write secure, optimized, and well-documented code

Available Tools:
- screenshot: Capture screenshots of websites
- web_search: Search the web using AI Search
- generate_image: Create images with AI
- analyze_code: Review and improve code quality
- execute_workflow: Run code review workflows
- save_to_storage: Store files in R2
- query_database: Execute D1 database queries
- get_ai_model: Get information about available AI models

When writing code:
- Always use TypeScript with proper types
- Include error handling and validation
- Use Cloudflare bindings efficiently
- Follow security best practices
- Add comments for complex logic
- Structure code for maintainability

Response format:
- For code: Use markdown code blocks with language tags
- For explanations: Be clear and concise
- For errors: Provide actionable solutions`;

// ==================== AUTH & UTILS ====================
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return (await hashPassword(password)) === hash;
}

async function generateToken(userId: string): Promise<string> {
  const token = crypto.randomUUID();
  return btoa(`${userId}:${token}`);
}

async function verifyToken(token: string): Promise<string | null> {
  try {
    const decoded = atob(token);
    const [userId] = decoded.split(':');
    return userId;
  } catch {
    return null;
  }
}

// ==================== AUTH ROUTES ====================
app.post('/api/auth/signup', async (c) => {
  try {
    const { email, password, name } = await c.req.json();
    const userId = crypto.randomUUID();
    const hashedPassword = await hashPassword(password);
    
    await c.env.AI_CHAT_DB.prepare(`
      INSERT INTO users (id, email, password, name, created_at, settings)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      userId,
      email,
      hashedPassword,
      name,
      Date.now(),
      JSON.stringify({ theme: 'dark', model: '@cf/meta/llama-3.1-8b-instruct' })
    ).run();
    
    const token = await generateToken(userId);
    
    c.env.ANALYTICS.writeDataPoint({
      blobs: [userId, 'signup', email],
      doubles: [1],
      indexes: ['auth']
    });
    
    return c.json({ success: true, token, userId, name });
  } catch (error: any) {
    return c.json({ error: error.message }, 400);
  }
});

app.post('/api/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json();
    
    const result = await c.env.AI_CHAT_DB.prepare(
      'SELECT * FROM users WHERE email = ?'
    ).bind(email).first();
    
    if (!result || !(await verifyPassword(password, result.password as string))) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    
    const token = await generateToken(result.id as string);
    
    c.env.ANALYTICS.writeDataPoint({
      blobs: [result.id as string, 'login', email],
      doubles: [1],
      indexes: ['auth']
    });
    
    return c.json({
      success: true,
      token,
      userId: result.id,
      name: result.name,
      settings: JSON.parse(result.settings as string)
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 400);
  }
});

// ==================== TOOLS IMPLEMENTATION ====================
const createTools = (env: Env, userId: string) => [
  tool({
    name: 'screenshot',
    description: 'Capture a screenshot of any website. Returns base64 image data.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL of the website to screenshot'
        },
        fullPage: {
          type: 'boolean',
          description: 'Whether to capture the full page or just viewport'
        }
      },
      required: ['url']
    },
    function: async ({ url, fullPage }: { url: string; fullPage?: boolean }) => {
      try {
        const browser = await puppeteer.launch(env.MYBROWSER);
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0' });
        
        const screenshot = await page.screenshot({
          fullPage: fullPage || false,
          type: 'jpeg',
          quality: 80
        });
        
        await browser.close();
        
        // Store in R2
        const key = `screenshots/${userId}/${Date.now()}.jpg`;
        await env.FILE_STORAGE.put(key, screenshot);
        
        env.ANALYTICS.writeDataPoint({
          blobs: [userId, 'screenshot', url],
          doubles: [1],
          indexes: ['tool_usage']
        });
        
        return {
          success: true,
          url: `/api/files/${key}`,
          data: Buffer.from(screenshot).toString('base64').slice(0, 1000) + '...'
        };
      } catch (error: any) {
        return { error: error.message };
      }
    }
  }),
  
  tool({
    name: 'web_search',
    description: 'Search the web for current information using AI-powered search.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        }
      },
      required: ['query']
    },
    function: async ({ query }: { query: string }) => {
      try {
        const answer = await env.AI.autorag('wave').aiSearch({
          query: query,
        });
        
        env.ANALYTICS.writeDataPoint({
          blobs: [userId, 'web_search', query],
          doubles: [1],
          indexes: ['tool_usage']
        });
        
        return {
          success: true,
          results: answer,
          query
        };
      } catch (error: any) {
        return { error: error.message };
      }
    }
  }),
  
  tool({
    name: 'generate_image',
    description: 'Generate an image using AI based on a text prompt.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The text description of the image to generate'
        },
        steps: {
          type: 'number',
          description: 'Number of diffusion steps (1-8, default 4)'
        }
      },
      required: ['prompt']
    },
    function: async ({ prompt, steps }: { prompt: string; steps?: number }) => {
      try {
        const response = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
          prompt,
          steps: steps || 4,
          seed: Math.floor(Math.random() * 10000)
        });
        
        // Store in R2
        const imageData = Buffer.from(response.image, 'base64');
        const key = `images/${userId}/${Date.now()}.jpg`;
        await env.FILE_STORAGE.put(key, imageData);
        
        env.ANALYTICS.writeDataPoint({
          blobs: [userId, 'generate_image', prompt],
          doubles: [1],
          indexes: ['tool_usage']
        });
        
        return {
          success: true,
          url: `/api/files/${key}`,
          prompt
        };
      } catch (error: any) {
        return { error: error.message };
      }
    }
  }),
  
  tool({
    name: 'analyze_code',
    description: 'Analyze code for quality, security issues, and best practices.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The code to analyze'
        },
        language: {
          type: 'string',
          description: 'Programming language (typescript, javascript, python, etc)'
        }
      },
      required: ['code']
    },
    function: async ({ code, language }: { code: string; language?: string }) => {
      try {
        const analysis = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            {
              role: 'system',
              content: 'You are a code review expert. Analyze the code for bugs, security issues, performance problems, and style issues. Provide specific, actionable feedback.'
            },
            {
              role: 'user',
              content: `Language: ${language || 'unknown'}\n\nCode:\n${code}`
            }
          ]
        });
        
        env.ANALYTICS.writeDataPoint({
          blobs: [userId, 'analyze_code', language || 'unknown'],
          doubles: [1],
          indexes: ['tool_usage']
        });
        
        return {
          success: true,
          analysis: analysis.response,
          language: language || 'unknown'
        };
      } catch (error: any) {
        return { error: error.message };
      }
    }
  }),
  
  tool({
    name: 'save_to_storage',
    description: 'Save a file to R2 storage. Returns the file URL.',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Name of the file'
        },
        content: {
          type: 'string',
          description: 'File content (text or base64 for binary)'
        },
        contentType: {
          type: 'string',
          description: 'MIME type of the file'
        }
      },
      required: ['filename', 'content']
    },
    function: async ({ filename, content, contentType }: {
      filename: string;
      content: string;
      contentType?: string;
    }) => {
      try {
        const key = `files/${userId}/${Date.now()}-${filename}`;
        await env.FILE_STORAGE.put(key, content, {
          httpMetadata: {
            contentType: contentType || 'application/octet-stream'
          }
        });
        
        env.ANALYTICS.writeDataPoint({
          blobs: [userId, 'save_file', filename],
          doubles: [content.length],
          indexes: ['tool_usage']
        });
        
        return {
          success: true,
          url: `/api/files/${key}`,
          key
        };
      } catch (error: any) {
        return { error: error.message };
      }
    }
  }),
  
  tool({
    name: 'query_database',
    description: 'Execute a SQL query on the D1 database. Use for data retrieval.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL query to execute'
        },
        params: {
          type: 'array',
          description: 'Query parameters for prepared statements'
        }
      },
      required: ['query']
    },
    function: async ({ query, params }: { query: string; params?: any[] }) => {
      try {
        const stmt = env.AI_CHAT_DB.prepare(query);
        const result = params
          ? await stmt.bind(...params).all()
          : await stmt.all();
        
        env.ANALYTICS.writeDataPoint({
          blobs: [userId, 'database_query', query.substring(0, 50)],
          doubles: [result.results.length],
          indexes: ['tool_usage']
        });
        
        return {
          success: true,
          results: result.results,
          count: result.results.length
        };
      } catch (error: any) {
        return { error: error.message };
      }
    }
  }),
  
  tool({
    name: 'get_ai_models',
    description: 'Get list of available AI models with their capabilities and pricing.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category: text-generation, text-to-image, speech-recognition, etc'
        }
      }
    },
    function: async ({ category }: { category?: string }) => {
      const models = {
        'text-generation': [
          '@cf/meta/llama-3.1-8b-instruct',
          '@cf/meta/llama-3.1-70b-instruct',
          '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          '@hf/nousresearch/hermes-2-pro-mistral-7b',
          '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b'
        ],
        'text-to-image': [
          '@cf/black-forest-labs/flux-1-schnell',
          '@cf/stabilityai/stable-diffusion-xl-base-1.0'
        ],
        'speech-recognition': [
          '@cf/openai/whisper'
        ],
        'translation': [
          '@cf/meta/m2m100-1.2b'
        ],
        'embedding': [
          '@cf/baai/bge-base-en-v1.5'
        ]
      };
      
      const result = category && models[category]
        ? { [category]: models[category] }
        : models;
      
      return {
        success: true,
        models: result,
        total: Object.values(result).flat().length
      };
    }
  })
];

// ==================== CHAT ROUTES ====================
app.post('/api/chat', async (c) => {
  try {
    const { message, sessionId, model = '@cf/meta/llama-3.1-8b-instruct', useTools = true } = await c.req.json();
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    const userId = await verifyToken(authHeader.replace('Bearer ', ''));
    if (!userId) {
      return c.json({ error: 'Invalid token' }, 401);
    }
    
    // Track analytics
    c.env.ANALYTICS.writeDataPoint({
      blobs: [userId, sessionId, 'chat_request'],
      doubles: [1],
      indexes: [model]
    });
    
    // Get chat history from KV
    const historyKey = `chat:${sessionId}`;
    const history = await c.env.CHAT_SESSIONS.get(historyKey, 'json') as any[] || [];
    
    // Add user message
    history.push({ role: 'user', content: message, timestamp: Date.now() });
    
    // Prepare messages with system prompt
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-20) // Keep last 20 messages
    ];
    
    let response;
    
    if (useTools) {
      // Use AI with tools
      const tools = createTools(c.env, userId);
      response = await runWithTools(c.env.AI, model, {
        messages,
        tools
      }, {
        maxRecursiveToolRuns: 3,
        streamFinalResponse: false
      });
    } else {
      // Regular AI call
      response = await c.env.AI.run(model, {
        messages
      });
    }
    
    const assistantMessage = typeof response === 'string' ? response : response.response;
    history.push({ role: 'assistant', content: assistantMessage, timestamp: Date.now() });
    
    // Store in KV (7 days TTL)
    await c.env.CHAT_SESSIONS.put(historyKey, JSON.stringify(history), {
      expirationTtl: 7 * 24 * 60 * 60
    });
    
    return c.json({
      response: assistantMessage,
      model,
      sessionId,
      tokensUsed: assistantMessage.length / 4 // Rough estimate
    });
  } catch (error: any) {
    console.error('Chat error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ==================== STREAMING CHAT ====================
app.post('/api/chat/stream', async (c) => {
  const { message, sessionId, model = '@cf/meta/llama-3.1-8b-instruct' } = await c.req.json();
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const userId = await verifyToken(authHeader.replace('Bearer ', ''));
  if (!userId) {
    return c.json({ error: 'Invalid token' }, 401);
  }
  
  return streamSSE(c, async (stream) => {
    try {
      const historyKey = `chat:${sessionId}`;
      const history = await c.env.CHAT_SESSIONS.get(historyKey, 'json') as any[] || [];
      history.push({ role: 'user', content: message, timestamp: Date.now() });
      
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-20)
      ];
      
      const eventStream = await c.env.AI.run(model, {
        messages,
        stream: true
      });
      
      let fullResponse = '';
      
      for await (const chunk of eventStream) {
        if (chunk.response) {
          fullResponse += chunk.response;
          await stream.writeSSE({
            data: JSON.stringify({ content: chunk.response, done: false })
          });
        }
      }
      
      history.push({ role: 'assistant', content: fullResponse, timestamp: Date.now() });
      await c.env.CHAT_SESSIONS.put(historyKey, JSON.stringify(history), {
        expirationTtl: 7 * 24 * 60 * 60
      });
      
      await stream.writeSSE({
        data: JSON.stringify({ content: '', done: true })
      });
    } catch (error: any) {
      await stream.writeSSE({
        data: JSON.stringify({ error: error.message, done: true })
      });
    }
  });
});

// ==================== VOICE AGENT ====================
app.get('/api/voice/connect', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const userId = await verifyToken(authHeader.replace('Bearer ', ''));
  if (!userId) {
    return c.json({ error: 'Invalid token' }, 401);
  }
  
  // Upgrade to WebSocket
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.json({ error: 'Expected WebSocket upgrade' }, 426);
  }
  
  const { socket, response } = Durable.upgradeWebSocket(c.req.raw);
  
  // Connect to Deepgram Voice Agent
  const deepgramWs = new WebSocket(
    `wss://agent.deepgram.com/v1/agent/converse`,
    {
      headers: {
        'Authorization': `Token ${c.env.DEEPGRAM_API_KEY}`
      }
    }
  );
  
  deepgramWs.addEventListener('open', () => {
    deepgramWs.send(JSON.stringify({
      type: 'Settings',
      audio: {
        input: { encoding: 'linear16', sample_rate: 16000 },
        output: { encoding: 'linear16', sample_rate: 24000 }
      },
      agent: {
        listen: { provider: { model: 'nova-3' } },
        think: {
          provider: { model: 'gpt-4o-mini' },
          prompt: SYSTEM_PROMPT
        },
        speak: { provider: { model: 'aura-2-andromeda-en' } }
      }
    }));
  });
  
  // Forward messages between client and Deepgram
  socket.addEventListener('message', (event) => {
    deepgramWs.send(event.data);
  });
  
  deepgramWs.addEventListener('message', (event) => {
    socket.send(event.data);
  });
  
  socket.addEventListener('close', () => {
    deepgramWs.close();
  });
  
  return response;
});

// ==================== FILE STORAGE ====================
app.get('/api/files/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.FILE_STORAGE.get(key);
  
  if (!object) {
    return c.json({ error: 'File not found' }, 404);
  }
  
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000'
    }
  });
});

app.post('/api/files/upload', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    const userId = await verifyToken(authHeader.replace('Bearer ', ''));
    if (!userId) {
      return c.json({ error: 'Invalid token' }, 401);
    }
    
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }
    
    const key = `uploads/${userId}/${Date.now()}-${file.name}`;
    await c.env.FILE_STORAGE.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type
      }
    });
    
    c.env.ANALYTICS.writeDataPoint({
      blobs: [userId, 'file_upload', file.name],
      doubles: [file.size],
      indexes: ['storage']
    });
    
    return c.json({
      success: true,
      url: `/api/files/${key}`,
      key,
      size: file.size
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ==================== SESSION MANAGEMENT ====================
app.get('/api/sessions', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    const userId = await verifyToken(authHeader.replace('Bearer ', ''));
    if (!userId) {
      return c.json({ error: 'Invalid token' }, 401);
    }
    
    const list = await c.env.CHAT_SESSIONS.list({ prefix: `chat:` });
    const sessions = await Promise.all(
      list.keys.map(async (key) => {
        const history = await c.env.CHAT_SESSIONS.get(key.name, 'json') as any[];
        return {
          id: key.name.replace('chat:', ''),
          lastMessage: history[history.length - 1],
          messageCount: history.length
        };
      })
    );
    
    return c.json({ sessions });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

app.delete('/api/sessions/:sessionId', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    const userId = await verifyToken(authHeader.replace('Bearer ', ''));
    if (!userId) {
      return c.json({ error: 'Invalid token' }, 401);
    }
    
    const sessionId = c.req.param('sessionId');
    await c.env.CHAT_SESSIONS.delete(`chat:${sessionId}`);
    
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ==================== ANALYTICS ====================
app.get('/api/analytics', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    const userId = await verifyToken(authHeader.replace('Bearer ', ''));
    if (!userId) {
      return c.json({ error: 'Invalid token' }, 401);
    }
    
    // Query analytics (this is a placeholder - actual implementation depends on your setup)
    return c.json({
      totalRequests: 0,
      toolUsage: {},
      modelUsage: {}
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: Date.now(),
    version: '1.0.0'
  });
});

export default app;

// ==================== DURABLE OBJECTS ====================
export class ChatDurableObject {
  state: DurableObjectState;
  env: Env;
  sessions: Map<string, WebSocket>;
  
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }
  
  async fetch(request: Request) {
    const url = new URL(request.url);
    
    if (url.pathname === '/websocket') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      this.handleSession(server);
      
      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }
    
    return new Response('Not found', { status: 404 });
  }
  
  async handleSession(webSocket: WebSocket) {
    webSocket.accept();
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, webSocket);
    
    webSocket.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        // Handle different message types
        this.broadcast(sessionId, data);
      } catch (error) {
        console.error('WebSocket error:', error);
      }
    });
    
    webSocket.addEventListener('close', () => {
      this.sessions.delete(sessionId);
    });
  }
  
  broadcast(excludeSession: string, message: any) {
    const payload = JSON.stringify(message);
    for (const [id, ws] of this.sessions) {
      if (id !== excludeSession) {
        ws.send(payload);
      }
    }
  }
}
