'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { 
  Code2, 
  Image, 
  Search, 
  Camera, 
  Palette, 
  Terminal, 
  Sparkles,
  Send,
  Plus,
  X,
  ChevronDown,
  FileCode,
  Zap,
  Brain,
  Cpu,
  Globe,
  Eye,
  Copy,
  Check,
  Settings,
  Maximize2,
  Download,
  Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Cloudflare AI Models organized by category
const AI_MODELS = {
  'Text Generation': [
    { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', description: 'Fast and efficient' },
    { id: '@cf/meta/llama-3-8b-instruct', name: 'Llama 3 8B', description: 'Balanced performance' },
    { id: '@cf/mistral/mistral-7b-instruct-v0.1', name: 'Mistral 7B', description: 'Efficient inference' },
    { id: '@cf/qwen/qwen1.5-14b-chat-awq', name: 'Qwen 1.5 14B', description: 'Multilingual support' },
  ],
  'Code Generation': [
    { id: '@hf/thebloke/deepseek-coder-6.7b-instruct-awq', name: 'DeepSeek Coder', description: 'Specialized for code' },
    { id: '@hf/thebloke/codellama-7b-instruct-awq', name: 'CodeLlama 7B', description: 'Code-focused model' },
  ],
  'Image Generation': [
    { id: '@cf/stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL Base', description: 'High quality images' },
    { id: '@cf/lykon/dreamshaper-8-lcm', name: 'DreamShaper 8', description: 'Fast generation' },
    { id: '@cf/bytedance/stable-diffusion-xl-lightning', name: 'SDXL Lightning', description: 'Ultra-fast' },
  ],
  'Vision': [
    { id: '@cf/llava-hf/llava-1.5-7b-hf', name: 'LLaVA 1.5', description: 'Image understanding' },
    { id: '@cf/unum/uform-gen2-qwen-500m', name: 'UForm Gen2', description: 'Vision-language' },
  ],
  'Embeddings': [
    { id: '@cf/baai/bge-base-en-v1.5', name: 'BGE Base EN', description: 'Text embeddings' },
    { id: '@cf/baai/bge-small-en-v1.5', name: 'BGE Small EN', description: 'Lightweight embeddings' },
  ]
};

const TOOLS = [
  { id: 'code', name: 'Code Canvas', icon: Code2, color: 'text-blue-500' },
  { id: 'image', name: 'Image Gen', icon: Image, color: 'text-purple-500' },
  { id: 'search', name: 'Web Search', icon: Search, color: 'text-green-500' },
  { id: 'screenshot', name: 'Screenshot', icon: Camera, color: 'text-orange-500' },
  { id: 'style', name: 'Style Editor', icon: Palette, color: 'text-pink-500' },
  { id: 'terminal', name: 'Terminal', icon: Terminal, color: 'text-gray-500' },
];

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool?: string;
  toolOutput?: any;
  timestamp: Date;
};

type ToolState = {
  active: string | null;
  output: any;
};

export default function AICodeAgent() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I\'m your AI Code Agent powered by Cloudflare Workers AI. I can help you with code generation, image creation, web searches, and much more. What would you like to build today?',
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState('@cf/meta/llama-3.1-8b-instruct');
  const [selectedCategory, setSelectedCategory] = useState('Text Generation');
  const [toolState, setToolState] = useState<ToolState>({ active: null, output: null });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleToolSelect = (toolId: string) => {
    setToolState({ active: toolId, output: null });
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const simulateToolExecution = useCallback((tool: string, query: string) => {
    switch (tool) {
      case 'code':
        return {
          type: 'code',
          language: 'javascript',
          code: `// Generated with ${selectedModel}\nfunction example() {\n  console.log("Hello from AI Code Agent!");\n  return true;\n}\n\nexample();`
        };
      case 'image':
        return {
          type: 'image',
          url: 'https://via.placeholder.com/512x512/667eea/ffffff?text=AI+Generated+Image',
          prompt: query
        };
      case 'search':
        return {
          type: 'search',
          results: [
            { title: 'Result 1', url: 'https://example.com/1', snippet: 'Relevant information found...' },
            { title: 'Result 2', url: 'https://example.com/2', snippet: 'More details here...' }
          ]
        };
      case 'screenshot':
        return {
          type: 'screenshot',
          url: 'https://via.placeholder.com/800x600/4338ca/ffffff?text=Screenshot+Captured',
          timestamp: new Date().toISOString()
        };
      case 'style':
        return {
          type: 'style',
          css: `/* AI-generated styles */\n.container {\n  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n  padding: 2rem;\n  border-radius: 1rem;\n}`
        };
      case 'terminal':
        return {
          type: 'terminal',
          command: query,
          output: '$ ' + query + '\n> Command executed successfully\n> Process completed with exit code 0'
        };
      default:
        return null;
    }
  }, [selectedModel]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);

    // Simulate AI processing
    setTimeout(() => {
      const toolOutput = toolState.active ? simulateToolExecution(toolState.active, input) : null;
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: toolState.active 
          ? `I've processed your request using the ${TOOLS.find(t => t.id === toolState.active)?.name}. Here are the results:`
          : `Based on your query using ${AI_MODELS[selectedCategory as keyof typeof AI_MODELS].find(m => m.id === selectedModel)?.name}, here's my response: ${input}`,
        tool: toolState.active || undefined,
        toolOutput,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      setIsProcessing(false);
      setToolState({ active: null, output: null });
    }, 1500);
  }, [input, isProcessing, toolState, selectedModel, selectedCategory, simulateToolExecution]);

  const renderToolOutput = (tool: string, output: any, messageId: string) => {
    switch (tool) {
      case 'code':
        return (
          <Card className="mt-3">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode className="h-4 w-4" />
                  <CardTitle className="text-sm">Code Output</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(output.code, `code-${messageId}`)}
                >
                  {copiedId === `code-${messageId}` ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg overflow-x-auto text-sm">
                <code>{output.code}</code>
              </pre>
            </CardContent>
          </Card>
        );
      case 'image':
        return (
          <Card className="mt-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Generated Image
              </CardTitle>
            </CardHeader>
            <CardContent>
              <img src={output.url} alt={output.prompt} className="rounded-lg w-full" />
              <p className="text-xs text-muted-foreground mt-2">Prompt: {output.prompt}</p>
            </CardContent>
          </Card>
        );
      case 'search':
        return (
          <Card className="mt-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Search className="h-4 w-4" />
                Search Results
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {output.results.map((result: any, idx: number) => (
                <div key={idx} className="border-l-2 border-primary pl-3">
                  <a href={result.url} className="font-medium text-sm hover:underline" target="_blank" rel="noopener noreferrer">
                    {result.title}
                  </a>
                  <p className="text-xs text-muted-foreground mt-1">{result.snippet}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      case 'screenshot':
        return (
          <Card className="mt-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Camera className="h-4 w-4" />
                Screenshot Captured
              </CardTitle>
            </CardHeader>
            <CardContent>
              <img src={output.url} alt="Screenshot" className="rounded-lg w-full border" />
              <p className="text-xs text-muted-foreground mt-2">Captured at: {new Date(output.timestamp).toLocaleString()}</p>
            </CardContent>
          </Card>
        );
      case 'style':
        return (
          <Card className="mt-3">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Palette className="h-4 w-4" />
                  Style Output
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(output.css, `style-${messageId}`)}
                >
                  {copiedId === `style-${messageId}` ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg overflow-x-auto text-sm">
                <code>{output.css}</code>
              </pre>
            </CardContent>
          </Card>
        );
      case 'terminal':
        return (
          <Card className="mt-3 bg-slate-950 text-slate-50 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                Terminal Output
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-sm font-mono">
                <code>{output.output}</code>
              </pre>
            </CardContent>
          </Card>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Sidebar */}
      <div className={cn(
        "border-r bg-white dark:bg-slate-950 transition-all duration-300 flex flex-col",
        sidebarOpen ? "w-80" : "w-0 overflow-hidden"
      )}>
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-sm">AI Code Agent</h2>
                <p className="text-xs text-muted-foreground">Cloudflare AI</p>
              </div>
            </div>
          </div>
          
          {/* Model Selection */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Model Category</label>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(AI_MODELS).map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 mt-3">
            <label className="text-xs font-medium text-muted-foreground">AI Model</label>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_MODELS[selectedCategory as keyof typeof AI_MODELS]?.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex flex-col">
                      <span className="font-medium">{model.name}</span>
                      <span className="text-xs text-muted-foreground">{model.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Tools
              </h3>
              <div className="space-y-1">
                {TOOLS.map((tool) => (
                  <Button
                    key={tool.id}
                    variant={toolState.active === tool.id ? "secondary" : "ghost"}
                    className="w-full justify-start"
                    size="sm"
                    onClick={() => handleToolSelect(tool.id)}
                  >
                    <tool.icon className={cn("h-4 w-4 mr-2", tool.color)} />
                    {tool.name}
                    {toolState.active === tool.id && (
                      <Badge variant="outline" className="ml-auto">Active</Badge>
                    )}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Capabilities
              </h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Cpu className="h-3 w-3" />
                  Multi-model support
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Globe className="h-3 w-3" />
                  Web-enabled search
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Eye className="h-3 w-3" />
                  Vision understanding
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Code2 className="h-3 w-3" />
                  Code generation
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="p-4 border-t">
          <Button variant="outline" size="sm" className="w-full">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b bg-white dark:bg-slate-950 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                <ChevronDown className={cn(
                  "h-4 w-4 transition-transform",
                  sidebarOpen ? "rotate-90" : "-rotate-90"
                )} />
              </Button>
              <div>
                <h1 className="font-semibold text-lg">AI Code Agent</h1>
                <p className="text-xs text-muted-foreground">
                  {AI_MODELS[selectedCategory as keyof typeof AI_MODELS]?.find(m => m.id === selectedModel)?.name} • 
                  {toolState.active ? ` ${TOOLS.find(t => t.id === toolState.active)?.name} Active` : ' Ready'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Online
              </Badge>
              <Button variant="ghost" size="sm">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-6" ref={scrollRef}>
          <div className="max-w-4xl mx-auto space-y-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-4",
                  message.role === 'user' ? "justify-end" : "justify-start"
                )}
              >
                {message.role === 'assistant' && (
                  <Avatar className="h-8 w-8 border-2 border-purple-500">
                    <AvatarImage src="" />
                    <AvatarFallback className="bg-gradient-to-br from-purple-500 to-blue-500 text-white">
                      AI
                    </AvatarFallback>
                  </Avatar>
                )}
                <div className={cn(
                  "max-w-[80%] space-y-2",
                  message.role === 'user' ? "items-end" : "items-start"
                )}>
                  <div className={cn(
                    "rounded-2xl px-4 py-3",
                    message.role === 'user' 
                      ? "bg-gradient-to-br from-purple-500 to-blue-500 text-white" 
                      : "bg-white dark:bg-slate-900 border"
                  )}>
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                  {message.tool && message.toolOutput && renderToolOutput(message.tool, message.toolOutput, message.id)}
                  <p className="text-xs text-muted-foreground px-2">
                    {message.timestamp.toLocaleTimeString()}
                  </p>
                </div>
                {message.role === 'user' && (
                  <Avatar className="h-8 w-8 border-2 border-blue-500">
                    <AvatarImage src="" />
                    <AvatarFallback className="bg-gradient-to-br from-blue-500 to-cyan-500 text-white">
                      U
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            ))}
            {isProcessing && (
              <div className="flex gap-4">
                <Avatar className="h-8 w-8 border-2 border-purple-500">
                  <AvatarFallback className="bg-gradient-to-br from-purple-500 to-blue-500 text-white">
                    AI
                  </AvatarFallback>
                </Avatar>
                <div className="bg-white dark:bg-slate-900 border rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <div className="h-2 w-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="h-2 w-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="h-2 w-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t bg-white dark:bg-slate-950 p-4">
          <div className="max-w-4xl mx-auto">
            {toolState.active && (
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  {TOOLS.find(t => t.id === toolState.active)?.icon && (
                    <span>{TOOLS.find(t => t.id === toolState.active)!.icon({ className: 'h-3 w-3' })}</span>
                  )}
                  {TOOLS.find(t => t.id === toolState.active)?.name} Active
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setToolState({ active: null, output: null })}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="relative">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={toolState.active 
                  ? `Enter ${TOOLS.find(t => t.id === toolState.active)?.name} parameters...`
                  : "Ask anything or describe what you want to build..."
                }
                className="min-h-[100px] pr-24 resize-none rounded-2xl"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />
              <div className="absolute bottom-3 right-3 flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!input.trim() || isProcessing}
                  className="h-8 w-8 p-0 bg-gradient-to-br from-purple-500 to-blue-500"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>
            <p className="text-xs text-center text-muted-foreground mt-3">
              Powered by Cloudflare Workers AI • {messages.length} messages
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AICodeAgent;
