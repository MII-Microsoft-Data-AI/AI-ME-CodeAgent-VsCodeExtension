# CodeAgent Backend Integration Guide

## Overview

This document provides comprehensive information on integrating a custom CodeAgent backend with the Cline VS Code extension. The CodeAgent provider is designed to be fully compatible with OpenAI's API structure, making it easy to integrate with any OpenAI-compatible backend.

---

## Table of Contents

1. [Backend API Requirements](#backend-api-requirements)
2. [API Endpoints Schema](#api-endpoints-schema)
3. [Authentication](#authentication)
4. [Request/Response Examples](#requestresponse-examples)
5. [Extension Configuration Files](#extension-configuration-files)
6. [Frontend Customization Guide](#frontend-customization-guide)
7. [Backend Integration Points](#backend-integration-points)
8. [Testing & Debugging](#testing--debugging)

---

## Backend API Requirements

Your CodeAgent backend must implement the following OpenAI-compatible endpoints:

### Required Endpoints

1. **GET /v1/models** - List available models
2. **POST /v1/chat/completions** - Handle chat completion requests

### Base URL Configuration

The extension will automatically handle the `/v1` prefix. Your backend should be accessible at:
- `http://your-backend.com` (extension adds `/v1` automatically)
- Or `http://your-backend.com/v1` (extension removes duplicate `/v1`)

**Examples:**
- User enters: `http://localhost:8000` → Extension uses: `http://localhost:8000/v1/chat/completions`
- User enters: `http://localhost:8000/v1` → Extension uses: `http://localhost:8000/v1/chat/completions`

---

## API Endpoints Schema

### 1. Models List Endpoint

**Endpoint:** `GET /v1/models`

**Headers:**
```http
Authorization: Bearer YOUR_API_KEY
HTTP-Referer: https://cline.bot
X-Title: Cline-CodeAgent
```

**Response Schema:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "model-id-1",
      "object": "model",
      "created": 1234567890,
      "owned_by": "organization-name",
      "permission": [],
      "root": "model-id-1",
      "parent": null,
      
      // Extension-specific fields (optional but recommended)
      "max_tokens": 8192,
      "context_window": 128000,
      "supports_images": true,
      "supports_prompt_cache": false,
      "input_price": 0.0,
      "output_price": 0.0,
      "description": "Model description"
    },
    {
      "id": "model-id-2",
      "object": "model",
      // ... more models
    }
  ]
}
```

**Field Mapping:**
The extension will look for these fields (in order of preference):

| Extension Field | Backend Field Options (checked in order) |
|----------------|------------------------------------------|
| `id` | `id`, `model_id`, `name` |
| `maxTokens` | `max_tokens`, `maxTokens`, `max_completion_tokens` |
| `contextWindow` | `context_window`, `contextWindow`, `context_length`, `max_context_length` |
| `supportsImages` | `supports_images`, `supportsImages`, `vision`, `multimodal` (defaults to `true`) |
| `supportsPromptCache` | `supports_prompt_cache`, `supportsPromptCache` (defaults to `false`) |
| `inputPrice` | `input_price`, `inputPrice`, `prompt_price` (per million tokens, defaults to `0`) |
| `outputPrice` | `output_price`, `outputPrice`, `completion_price` (per million tokens, defaults to `0`) |
| `description` | `description`, `desc` |

**Minimal Valid Response:**
```json
{
  "data": [
    {
      "id": "gpt-4",
      "max_tokens": 8192
    }
  ]
}
```

---

### 2. Chat Completions Endpoint

**Endpoint:** `POST /v1/chat/completions`

**Headers:**
```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
HTTP-Referer: https://cline.bot
X-Title: Cline-CodeAgent
```

**Request Schema:**
```json
{
  "model": "model-id",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful AI assistant."
    },
    {
      "role": "user",
      "content": "Hello, how are you?"
    },
    {
      "role": "assistant",
      "content": "I'm doing well, thank you!"
    },
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "What's in this image?"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
          }
        }
      ]
    }
  ],
  "temperature": 0,
  "max_tokens": 8192,
  "stream": true,
  "stream_options": {
    "include_usage": true
  }
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Model ID to use |
| `messages` | array | Yes | Array of message objects |
| `temperature` | number | No | Sampling temperature (0-2), default from model config |
| `max_tokens` | number | No | Maximum tokens to generate, default from model config |
| `stream` | boolean | Yes | Always `true` for Cline |
| `stream_options` | object | Yes | `{ "include_usage": true }` |

**Message Types:**

1. **Text-only message:**
```json
{
  "role": "user",
  "content": "Simple text message"
}
```

2. **Multi-modal message (with images):**
```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "What's in this image?"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/jpeg;base64,..."
      }
    }
  ]
}
```

**Response Schema (Streaming):**

The backend must return Server-Sent Events (SSE) with the following format:

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"model-id","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"model-id","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"model-id","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"model-id","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"prompt_tokens_details":{"cached_tokens":0}}}

data: [DONE]
```

**Key Response Fields:**

```typescript
// Chunk without usage (content chunks)
{
  "id": "chatcmpl-123",
  "object": "chat.completion.chunk",
  "created": 1234567890,
  "model": "model-id",
  "choices": [
    {
      "index": 0,
      "delta": {
        "role": "assistant",      // Only in first chunk
        "content": "text chunk"   // Content piece
      },
      "finish_reason": null       // null until last content chunk
    }
  ]
}

// Final chunk with usage (required)
{
  "id": "chatcmpl-123",
  "object": "chat.completion.chunk",
  "created": 1234567890,
  "model": "model-id",
  "choices": [
    {
      "index": 0,
      "delta": {},
      "finish_reason": "stop"     // "stop", "length", or "content_filter"
    }
  ],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150,
    
    // Optional: Prompt caching support
    "prompt_tokens_details": {
      "cached_tokens": 80,        // Tokens read from cache
      "caching_tokens": 20        // Tokens written to cache
    }
  }
}
```

**Usage Calculation:**
- The extension will calculate costs based on:
  - `prompt_tokens` × `inputPrice` (from model info)
  - `completion_tokens` × `outputPrice` (from model info)
  - `cached_tokens` × `cacheReadsPrice` (if caching is supported)
  - `caching_tokens` × `cacheWritesPrice` (if caching is supported)

---

## Authentication

The extension uses **Bearer token authentication**:

```http
Authorization: Bearer YOUR_API_KEY
```

Users configure this in the extension settings:
- **API Key**: Required field
- **Base URL**: Required field (e.g., `http://localhost:8000`)

---

## Request/Response Examples

### Example 1: Simple Text Chat

**Request:**
```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -H "HTTP-Referer: https://cline.bot" \
  -H "X-Title: Cline-CodeAgent" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "system", "content": "You are a helpful coding assistant."},
      {"role": "user", "content": "Write a Python hello world function"}
    ],
    "temperature": 0,
    "max_tokens": 8192,
    "stream": true,
    "stream_options": {"include_usage": true}
  }'
```

**Response Stream:**
```
data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Here"},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"'s"},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" a"},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" simple"},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" hello"},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" function"},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":":\n\n```python\ndef hello_world():\n    print(\"Hello, World!\")\n```"},"finish_reason":null}]}

data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":25,"completion_tokens":18,"total_tokens":43}}

data: [DONE]
```

### Example 2: Image Analysis Request

**Request:**
```json
{
  "model": "gpt-4-vision",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant that can analyze images."
    },
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "What's in this screenshot?"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,iVBORw0KGgoAAAANS..."
          }
        }
      ]
    }
  ],
  "temperature": 0,
  "max_tokens": 4096,
  "stream": true,
  "stream_options": {"include_usage": true}
}
```

---

## Extension Configuration Files

### Files You Can Customize for Your Backend

#### 1. **Backend API Handler**
**File:** `src/core/api/providers/codeagent.ts`

**Purpose:** Core logic for communicating with your backend

**Key areas to customize:**
```typescript
// Line ~38-48: Base URL formatting
private ensureClient(): OpenAI {
  // Customize how the base URL is processed
  let baseUrl = this.options.codeagentBaseUrl.trim()
  baseUrl = baseUrl.replace(/\/+$/, "")
  if (baseUrl.endsWith("/v1")) {
    baseUrl = baseUrl.slice(0, -3)
  }
  
  // Customize default headers sent to your backend
  this.client = new OpenAI({
    baseURL: baseUrl,
    apiKey: this.options.codeagentApiKey,
    defaultHeaders: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline-CodeAgent",
      // Add custom headers here
    },
  })
}

// Line ~62-84: Message creation and streaming
async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
  // Customize request parameters
  const temperature = modelInfo?.temperature ?? openAiModelInfoSaneDefaults.temperature
  const maxTokens = modelInfo?.maxTokens && modelInfo.maxTokens > 0 ? modelInfo.maxTokens : undefined
  
  const stream = await client.chat.completions.create({
    model: modelId,
    messages: openAiMessages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
    // Add custom parameters here
  })
}

// Line ~105-125: Token usage parsing
if (lastUsage) {
  const inputTokens = lastUsage.prompt_tokens || 0
  const outputTokens = lastUsage.completion_tokens || 0
  // Customize how caching tokens are extracted
  const cacheWriteTokens = (lastUsage as any).prompt_tokens_details?.caching_tokens || undefined
  const cacheReadTokens = (lastUsage as any).prompt_tokens_details?.cached_tokens || undefined
}
```

**When to modify:**
- Custom authentication headers
- Additional request parameters
- Different usage tracking format
- Custom error handling

---

#### 2. **Model Fetching Logic**
**File:** `src/core/controller/models/refreshCodeAgentModels.ts`

**Purpose:** Fetches and parses model list from your backend

**Key areas to customize:**
```typescript
// Line ~14-22: API request
const response = await fetch(`${baseURL}/v1/models`, {
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    // Add custom headers here
  },
})

// Line ~30-80: Model info extraction
const models: Record<string, ModelInfo> = {}
for (const model of data.data || data.models || data) {
  const modelId = model.id || model.model_id || model.name
  
  // Customize field mapping based on your backend's response format
  const maxTokens = 
    model.max_tokens || 
    model.maxTokens || 
    model.max_completion_tokens ||
    8192 // default
    
  const contextWindow = 
    model.context_window || 
    model.contextWindow || 
    model.context_length ||
    model.max_context_length ||
    128000 // default
    
  // Add more custom field mappings
}
```

**When to modify:**
- Your backend uses different field names
- Additional model metadata
- Custom model filtering logic
- Different API endpoint structure

---

#### 3. **Frontend Provider Component**
**File:** `webview-ui/src/components/settings/providers/CodeAgentProvider.tsx`

**Purpose:** UI component for CodeAgent settings

**Key areas to customize:**
```typescript
// Line ~20-40: Input fields
<VSCodeTextField
  value={apiConfiguration?.codeagentBaseUrl || ""}
  placeholder="http://localhost:8000"
  onInput={(e: any) => {
    // Customize validation or transformation
    const value = e.target.value
    handleInputChange("codeagentBaseUrl")(e)
  }}
>
  <span className="...">
    CodeAgent Base URL
    {/* Customize label and help text */}
  </span>
</VSCodeTextField>

// Line ~60-80: Model picker integration
<CodeAgentModelPicker
  key={`codeagent-${mode}`}
  mode={mode}
  modelId={currentModelId}
  modelInfo={currentModelInfo}
  onSelect={handleModelSelect}
  apiConfiguration={apiConfiguration}
  setApiConfiguration={setApiConfiguration}
/>
```

**Customization options:**
- Change placeholder URLs
- Add/remove input fields
- Custom validation messages
- Additional configuration options
- Help text and tooltips

---

#### 4. **Model Picker Component**
**File:** `webview-ui/src/components/settings/CodeAgentModelPicker.tsx`

**Purpose:** Searchable dropdown for selecting models

**Key areas to customize:**
```typescript
// Line ~40-80: Model fetching
const fetchModels = async () => {
  try {
    const models = await client.refreshCodeAgentModels()
    setCodeAgentModels(models)
    // Customize success handling
  } catch (error) {
    console.error("Error fetching models:", error)
    // Customize error handling
  }
}

// Line ~120-150: Model display
<div className="...">
  <div className="...">{model.id}</div>
  {/* Customize how model info is displayed */}
  {model.info.description && (
    <div className="...">{model.info.description}</div>
  )}
  {model.info.contextWindow && (
    <span className="...">
      {(model.info.contextWindow / 1000).toFixed(0)}k context
    </span>
  )}
</div>
```

**Customization options:**
- Model display format
- Search behavior (Fuse.js configuration)
- Model sorting
- Additional metadata display
- Custom icons or badges

---

#### 5. **Validation Logic**
**File:** `webview-ui/src/utils/validate.ts`

**Key areas to customize:**
```typescript
// Line ~60-80: CodeAgent validation
case "codeagent":
  // Customize validation rules
  if (!apiConfiguration.codeagentBaseUrl?.trim()) {
    return "CodeAgent Base URL is required"
  }
  if (!apiConfiguration.codeagentApiKey?.trim()) {
    return "CodeAgent API Key is required"
  }
  
  // Add custom URL validation
  try {
    new URL(apiConfiguration.codeagentBaseUrl)
  } catch {
    return "Invalid CodeAgent Base URL format"
  }
  
  // Add custom validation logic
  break
```

**When to modify:**
- Custom URL format requirements
- Additional validation rules
- API key format validation
- Connection testing

---

#### 6. **API Type Definitions**
**File:** `src/shared/api.ts`

**Key areas to customize:**
```typescript
// Add to ApiConfiguration interface
export interface ApiConfiguration {
  // ... existing fields
  codeagentApiKey?: string
  codeagentBaseUrl?: string
  
  // Add custom configuration fields here
  codeagentCustomHeader?: string
  codeagentTimeout?: number
}

// Add to mode-specific fields
planModeCodeagentModelId?: string
planModeCodeagentModelInfo?: ModelInfo
actModeCodeagentModelId?: string
actModeCodeagentModelInfo?: ModelInfo
```

---

#### 7. **Proto Definitions**
**File:** `proto/cline/models.proto`

**Current CodeAgent fields:**
```protobuf
message ModelsApiConfiguration {
  // Global fields (line 76-77)
  optional string codeagent_api_key = 76;
  optional string codeagent_base_url = 77;
  
  // Plan mode fields (line 133-134)
  optional string plan_mode_codeagent_model_id = 133;
  optional OpenRouterModelInfo plan_mode_codeagent_model_info = 134;
  
  // Act mode fields (line 233-234)
  optional string act_mode_codeagent_model_id = 233;
  optional OpenRouterModelInfo act_mode_codeagent_model_info = 234;
}

// Service definition
service ModelsService {
  // Line ~280
  rpc refreshCodeAgentModels(google.protobuf.Empty) returns (google.protobuf.StringValue);
}
```

**When to modify:**
- Add custom configuration fields
- Change field numbers (must be unique)
- After modifying, run: `npm run protos`

---

#### 8. **Storage Configuration**
**File:** `src/core/storage/disk.ts`

**Key areas:**
```typescript
// Line ~40-50: Add cache file for models
export const GlobalFileNames = {
  // ... existing files
  codeagentModels: "codeagent_models.json",
  // Add custom cache files here
}
```

---

#### 9. **State Management**
**File:** `webview-ui/src/context/ExtensionStateContext.tsx`

**Key areas to customize:**
```typescript
// Line ~80-100: Add state for CodeAgent models
export interface ExtensionState {
  // ... existing state
  codeagentModels: Record<string, ModelInfo>
  // Add custom state fields here
}

// Line ~200-220: Add setter
const setCodeAgentModels = useCallback((models: Record<string, ModelInfo>) => {
  setState((prevState) => ({
    ...prevState,
    codeagentModels: models,
  }))
}, [])
```

---

## Frontend Customization Guide

### Changing UI Text and Labels

**Welcome Screen:**
```typescript
// File: webview-ui/src/components/welcome/WelcomeView.tsx
// Line ~50
<p>
  Cline can work with CodeAgent, OpenAI, Anthropic, ...
  {/* Update this text to highlight CodeAgent */}
</p>
```

**Provider Selection:**
```typescript
// File: webview-ui/src/components/settings/ApiOptions.tsx
// Add CodeAgent to the provider list (already done)
```

### Adding Custom Configuration Fields

1. **Add to TypeScript types** (`src/shared/api.ts`)
2. **Add to Proto definitions** (`proto/cline/models.proto`)
3. **Run proto generation** (`npm run protos`)
4. **Add to conversion functions** (`src/shared/proto-conversions/models/api-configuration-conversion.ts`)
5. **Add UI input** (`webview-ui/src/components/settings/providers/CodeAgentProvider.tsx`)
6. **Add validation** (`webview-ui/src/utils/validate.ts`)

---

## Backend Integration Points

### Critical Integration Files (Summary)

| File | Purpose | When to Modify |
|------|---------|----------------|
| `src/core/api/providers/codeagent.ts` | API communication logic | Custom headers, request format, usage parsing |
| `src/core/controller/models/refreshCodeAgentModels.ts` | Model list fetching | Field name mapping, endpoint customization |
| `webview-ui/src/components/settings/providers/CodeAgentProvider.tsx` | Settings UI | Labels, placeholders, help text |
| `webview-ui/src/components/settings/CodeAgentModelPicker.tsx` | Model selection UI | Display format, search behavior |
| `webview-ui/src/utils/validate.ts` | Input validation | Validation rules, error messages |
| `proto/cline/models.proto` | Data structure definitions | New configuration fields |

---

## Testing & Debugging

### Testing Your Backend

1. **Test the models endpoint:**
```bash
curl http://localhost:8000/v1/models \
  -H "Authorization: Bearer your-api-key"
```

Expected response:
```json
{
  "data": [
    {"id": "model-1", "max_tokens": 8192}
  ]
}
```

2. **Test the chat endpoint:**
```bash
curl -N http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model-1",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true,
    "stream_options": {"include_usage": true}
  }'
```

Expected response: SSE stream with chunks

### Debugging in the Extension

1. **Enable developer mode:**
   - Open VS Code Developer Tools: `Help` → `Toggle Developer Tools`
   - Check Console for errors

2. **Check network requests:**
   - In Developer Tools → Network tab
   - Filter by your backend URL
   - Inspect request/response headers and body

3. **Add logging to CodeAgent handler:**
```typescript
// In src/core/api/providers/codeagent.ts
console.log("CodeAgent request:", {
  model: modelId,
  messages: openAiMessages,
  baseURL: this.options.codeagentBaseUrl
})
```

4. **Check model fetching:**
```typescript
// In src/core/controller/models/refreshCodeAgentModels.ts
console.log("Fetched models:", models)
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "CodeAgent API key is required" | API key not set | Configure in extension settings |
| "Failed to fetch models" | Wrong endpoint or URL | Check base URL format |
| No models appear in dropdown | Response format mismatch | Check field mapping in `refreshCodeAgentModels.ts` |
| Streaming not working | Missing `stream: true` | Backend must support SSE streaming |
| No usage stats | Missing usage in final chunk | Backend must include `usage` in last chunk |
| CORS errors | Missing CORS headers | Add CORS headers to backend responses |

### CORS Configuration (if backend is on different domain)

Your backend should include these headers:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, HTTP-Referer, X-Title
```

---

## Quick Start Checklist

- [ ] Backend implements `GET /v1/models` endpoint
- [ ] Backend implements `POST /v1/chat/completions` endpoint
- [ ] Backend supports streaming responses (SSE)
- [ ] Backend includes `usage` object in final stream chunk
- [ ] Backend accepts `Authorization: Bearer` header
- [ ] Models endpoint returns list with at least `id` field
- [ ] Chat endpoint returns chunks with `delta.content`
- [ ] Tested both endpoints with curl
- [ ] Configured Base URL in extension settings
- [ ] Configured API Key in extension settings
- [ ] Models appear in model picker dropdown
- [ ] Chat completion works end-to-end

---

## Advanced Customization

### Adding Custom Request Parameters

To add custom parameters to chat requests:

1. **Update handler options** (`src/core/api/providers/codeagent.ts`):
```typescript
interface CodeAgentHandlerOptions extends CommonApiHandlerOptions {
  codeagentCustomParam?: string
}
```

2. **Pass to API call**:
```typescript
const stream = await client.chat.completions.create({
  model: modelId,
  messages: openAiMessages,
  temperature,
  max_tokens: maxTokens,
  stream: true,
  stream_options: { include_usage: true },
  custom_param: this.options.codeagentCustomParam, // Add here
})
```

3. **Add to configuration types** (see Proto Definitions section)

4. **Add UI field** (see Frontend Provider Component section)

### Supporting Custom Model Metadata

If your backend returns additional model fields:

1. **Extend ModelInfo interface** (`src/shared/api.ts`):
```typescript
export interface ModelInfo {
  // ... existing fields
  customField?: string
}
```

2. **Update model parsing** (`src/core/controller/models/refreshCodeAgentModels.ts`):
```typescript
models[modelId] = {
  // ... existing mappings
  customField: model.custom_field || model.customField,
}
```

3. **Display in UI** (`webview-ui/src/components/settings/CodeAgentModelPicker.tsx`):
```typescript
{model.info.customField && (
  <span>{model.info.customField}</span>
)}
```

---

## Support & Resources

- **Extension Repository:** Check the repository README for updates
- **OpenAI API Reference:** https://platform.openai.com/docs/api-reference
- **Protocol Buffers:** Required knowledge for modifying `.proto` files
- **TypeScript:** Required for backend handler customization
- **React:** Required for frontend UI customization

---

## Appendix: File Tree

```
AI-ME-CodeAgent-VsCodeExtension/
├── src/
│   ├── core/
│   │   ├── api/
│   │   │   ├── providers/
│   │   │   │   └── codeagent.ts           # Backend API handler
│   │   │   └── index.ts                    # Provider switch case
│   │   ├── controller/
│   │   │   └── models/
│   │   │       └── refreshCodeAgentModels.ts  # Model fetching logic
│   │   └── storage/
│   │       └── disk.ts                     # Cache file names
│   ├── shared/
│   │   ├── api.ts                          # Type definitions
│   │   └── proto-conversions/
│   │       └── models/
│   │           └── api-configuration-conversion.ts  # Proto conversions
│   └── generated/                          # Auto-generated proto code
├── proto/
│   └── cline/
│       ├── models.proto                    # Proto definitions
│       └── state.proto
├── webview-ui/
│   └── src/
│       ├── components/
│       │   ├── settings/
│       │   │   ├── providers/
│       │   │   │   └── CodeAgentProvider.tsx  # Settings UI
│       │   │   ├── CodeAgentModelPicker.tsx   # Model picker UI
│       │   │   └── ApiOptions.tsx             # Provider list
│       │   └── welcome/
│       │       └── WelcomeView.tsx            # Welcome screen
│       ├── context/
│       │   └── ExtensionStateContext.tsx      # State management
│       └── utils/
│           └── validate.ts                    # Input validation
└── CodeAgentIntegrationDocs.md            # This file
```

---

**Last Updated:** 2025-10-05
**Extension Version:** 3.32.6
**Cline Fork:** AI-ME-CodeAgent-VsCodeExtension
