import { Agent, routeAgentRequest } from 'agents';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import puppeteer from '@cloudflare/puppeteer';

interface Env {
  AI: Ai;
  MYBROWSER: Fetcher;
  CHAT_SESSIONS: KVNamespace;
  FILE_STORAGE: R2Bucket;
  CHAT_DO: DurableObjectNamespace;
  AI_CHAT_DB: D1Database;
  ANALYTICS: AnalyticsEngineDataset;
  OPENAI_API_KEY?: string;
}

interface AgentState {
  conversationHistory: Array<{ role: string; content: string }>;
  currentProject: {
    name: string;
    files: Map<string, string>;
    dependencies: string[];
  } | null;
  toolsUsed: string[];
  lastUpdated: number;
}

// Main AI Code Agent
export class CodeAgent extends Agent<Env, AgentState> {
  initialState: AgentState = {
    conversationHistory: [],
    currentProject: null,
    toolsUsed: [],
    lastUpdated: Date.now(),
  };

  async onStart() {
    console.log(`Code Agent ${this.name} initialized`);
    
    // Initialize database schema
    await this.initializeDatabase();
  }

  async initializeDatabase() {
    await this.env.AI_CHAT_DB.prepare(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        agent_name TEXT,
        message TEXT,
        role TEXT,
        timestamp INTEGER
      )
    `).run();

    await this.env.AI_CHAT_DB.prepare(`
      CREATE TABLE IF NOT EXISTS code_projects (
        id TEXT PRIMARY KEY,
        agent_name TEXT,
        project_name TEXT,
        files TEXT,
        created_at INTEGER
      )
    `).run();
  }

  async onMessage(connection: any, message: any) {
    const data = JSON.parse(message);
    
    switch (data.type) {
      case 'chat':
        await this.handleChat(connection, data);
        break;
      case 'generate_code':
        await this.generateCode(connection, data);
        break;
      case 'screenshot':
        await this.takeScreenshot(connection, data);
        break;
      case 'web_search':
        await this.performWebSearch(connection, data);
        break;
      case 'generate_image':
        await this.generateImage(connection, data);
        break;
      case 'analyze_code':
        await this.analyzeCode(connection, data);
        break;
      default:
        connection.send(JSON.stringify({ type: 'error', message: 'Unknown command' }));
    }
  }

  // Chat with AI using multiple models
  async handleChat(connection: any, data: any) {
    const { prompt, model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' } = data;
    
    this.state.conversationHistory.push({
      role: 'user',
      content: prompt,
    });

    try {
      const response = await this.env.AI.run(model, {
        messages: this.state.conversationHistory,
        stream: true,
      });

      let fullResponse = '';
      const reader = response.body?.getReader();
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = new TextDecoder().decode(value);
          fullResponse += chunk;
          
          connection.send(JSON.stringify({
            type: 'chat_chunk',
            content: chunk,
          }));
        }
      }

      this.state.conversationHistory.push({
        role: 'assistant',
        content: fullResponse,
      });

      // Save to database
      await this.saveConversation(prompt, fullResponse);

      connection.send(JSON.stringify({
        type: 'chat_complete',
        message: 'Response complete',
      }));
    } catch (error) {
      connection.send(JSON.stringify({
        type: 'error',
        message: `Chat error: ${error}`,
      }));
    }
  }

  // Generate code using AI
  async generateCode(connection: any, data: any) {
    const { prompt, language = 'typescript', framework = 'cloudflare-worker' } = data;

    const systemPrompt = `You are an expert code generator specializing in ${framework}. 
Generate clean, production-ready ${language} code following best practices.
Include comments explaining complex logic.
Focus on Cloudflare Workers patterns including Durable Objects, KV, R2, D1, and Workers AI.`;

    try {
      const response = await this.env.AI.run('@hf/thebloke/deepseek-coder-6.7b-instruct-awq', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        stream: true,
      });

      let code = '';
      const reader = response.body?.getReader();
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = new TextDecoder().decode(value);
          code += chunk;
          
          connection.send(JSON.stringify({
            type: 'code_chunk',
            content: chunk,
          }));
        }
      }

      // Save generated code
      await this.saveGeneratedCode(language, code);

      connection.send(JSON.stringify({
        type: 'code_complete',
        code: code,
        language: language,
      }));
    } catch (error) {
      connection.send(JSON.stringify({
        type: 'error',
        message: `Code generation error: ${error}`,
      }));
    }
  }

  // Take screenshot using Browser Rendering
  async takeScreenshot(connection: any, data: any) {
    const { url } = data;

    try {
      const browser = await puppeteer.launch(this.env.MYBROWSER);
      const page = await browser.newPage();
      
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(url, { waitUntil: 'networkidle0' });

      const screenshot = await page.screenshot({ 
        encoding: 'base64',
        type: 'png',
        fullPage: true,
      });

      await browser.close();

      // Store in R2
      const fileName = `screenshots/${Date.now()}-${crypto.randomUUID()}.png`;
      await this.env.FILE_STORAGE.put(
        fileName,
        Buffer.from(screenshot, 'base64'),
        {
          httpMetadata: { contentType: 'image/png' },
        }
      );

      connection.send(JSON.stringify({
        type: 'screenshot_complete',
        screenshot: `data:image/png;base64,${screenshot}`,
        stored_path: fileName,
      }));
    } catch (error) {
      connection.send(JSON.stringify({
        type: 'error',
        message: `Screenshot error: ${error}`,
      }));
    }
  }

  // Web search and content extraction
  async performWebSearch(connection: any, data: any) {
    const { query, extractCode = false } = data;

    try {
      const browser = await puppeteer.launch(this.env.MYBROWSER);
      const page = await browser.newPage();
      
      // Search using DuckDuckGo
      await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
      await page.waitForSelector('.results');

      const results = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.results .result'));
        return items.slice(0, 5).map(item => {
          const title = item.querySelector('.result__title')?.textContent || '';
          const link = item.querySelector('.result__url')?.getAttribute('href') || '';
          const snippet = item.querySelector('.result__snippet')?.textContent || '';
          return { title, link, snippet };
        });
      });

      await browser.close();

      // If extractCode is true, analyze results with AI
      if (extractCode && results.length > 0) {
        const analysisPrompt = `Analyze these search results and extract relevant code examples or patterns:
${JSON.stringify(results, null, 2)}

Provide a summary of useful code patterns found.`;

        const analysis = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [{ role: 'user', content: analysisPrompt }],
        });

        connection.send(JSON.stringify({
          type: 'search_complete',
          results: results,
          analysis: analysis,
        }));
      } else {
        connection.send(JSON.stringify({
          type: 'search_complete',
          results: results,
        }));
      }
    } catch (error) {
      connection.send(JSON.stringify({
        type: 'error',
        message: `Search error: ${error}`,
      }));
    }
  }

  // Generate images using AI
  async generateImage(connection: any, data: any) {
    const { prompt, steps = 4 } = data;

    try {
      const response = await this.env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
        prompt: prompt,
        steps: steps,
      });

      // Store in R2
      const fileName = `images/${Date.now()}-${crypto.randomUUID()}.png`;
      const imageBuffer = Buffer.from(response.image, 'base64');
      
      await this.env.FILE_STORAGE.put(fileName, imageBuffer, {
        httpMetadata: { contentType: 'image/png' },
      });

      connection.send(JSON.stringify({
        type: 'image_complete',
        image: `data:image/png;base64,${response.image}`,
        stored_path: fileName,
      }));
    } catch (error) {
      connection.send(JSON.stringify({
        type: 'error',
        message: `Image generation error: ${error}`,
      }));
    }
  }

  // Analyze code quality and provide suggestions
  async analyzeCode(connection: any, data: any) {
    const { code, language } = data;

    const analysisPrompt = `Analyze this ${language} code and provide:
1. Code quality assessment
2. Security vulnerabilities
3. Performance improvements
4. Best practice recommendations
5. Refactoring suggestions

Code:
\`\`\`${language}
${code}
\`\`\``;

    try {
      const response = await this.env.AI.run('@cf/meta/llama-3.1-70b-instruct', {
        messages: [{ role: 'user', content: analysisPrompt }],
        stream: true,
      });

      let analysis = '';
      const reader = response.body?.getReader();
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = new TextDecoder().decode(value);
          analysis += chunk;
          
          connection.send(JSON.stringify({
            type: 'analysis_chunk',
            content: chunk,
          }));
        }
      }

      connection.send(JSON.stringify({
        type: 'analysis_complete',
        analysis: analysis,
      }));
    } catch (error) {
      connection.send(JSON.stringify({
        type: 'error',
        message: `Code analysis error: ${error}`,
      }));
    }
  }

  // Helper: Save conversation to D1
  async saveConversation(userMessage: string, aiResponse: string) {
    await this.env.AI_CHAT_DB.prepare(`
      INSERT INTO conversations (id, agent_name, message, role, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      this.name,
      userMessage,
      'user',
      Date.now()
    ).run();

    await this.env.AI_CHAT_DB.prepare(`
      INSERT INTO conversations (id, agent_name, message, role, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      this.name,
      aiResponse,
      'assistant',
      Date.now()
    ).run();
  }

  // Helper: Save generated code
  async saveGeneratedCode(language: string, code: string) {
    if (!this.state.currentProject) {
      this.state.currentProject = {
        name: `project-${Date.now()}`,
        files: new Map(),
        dependencies: [],
      };
    }

    const fileName = `generated.${language === 'typescript' ? 'ts' : language}`;
    this.state.currentProject.files.set(fileName, code);
    this.setState(this.state);

    // Save to D1
    await this.env.AI_CHAT_DB.prepare(`
      INSERT INTO code_projects (id, agent_name, project_name, files, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      this.name,
      this.state.currentProject.name,
      JSON.stringify(Array.from(this.state.currentProject.files.entries())),
      Date.now()
    ).run();
  }

  // Handle HTTP requests
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok', agent: this.name });
    }

    if (url.pathname === '/api/history') {
      return Response.json({ history: this.state.conversationHistory });
    }

    if (url.pathname === '/api/project') {
      return Response.json({ 
        project: this.state.currentProject ? {
          name: this.state.currentProject.name,
          files: Array.from(this.state.currentProject.files.entries()),
        } : null 
      });
    }

    return new Response('Not Found', { status: 404 });
  }
}

// Export the Agent
export default CodeAgent;

// Worker entry point
const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/api/models', async (c) => {
  const models = [
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/meta/llama-3.1-70b-instruct',
    '@cf/meta/llama-3.1-8b-instruct',
    '@hf/thebloke/deepseek-coder-6.7b-instruct-awq',
    '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    '@cf/black-forest-labs/flux-1-schnell',
  ];
  return c.json({ models });
});

app.all('/agents/*', async (c) => {
  return await routeAgentRequest(c.req.raw, c.env) || c.json({ error: 'Agent not found' }, 404);
});

export { app as default, CodeAgent as ChatDurableObject };
