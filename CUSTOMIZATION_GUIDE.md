# CodeAgent Customization Guide

## Overview

This guide provides detailed information about every file involved in the CodeAgent provider integration, including exact line numbers, code snippets, and what you can customize.

---

## Table of Contents

1. [Backend Integration Files](#backend-integration-files)
2. [Frontend UI Files](#frontend-ui-files)
3. [Type Definitions](#type-definitions)
4. [Proto Definitions](#proto-definitions)
5. [State Management](#state-management)
6. [Utility Files](#utility-files)
7. [Complete Customization Workflow](#complete-customization-workflow)

---

## Backend Integration Files

### 1. CodeAgent API Handler

**File:** `src/core/api/providers/codeagent.ts`
**Lines:** 1-145
**Purpose:** Core API communication logic

#### Section 1.1: Imports and Type Definitions (Lines 1-15)

```typescript
import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface CodeAgentHandlerOptions extends CommonApiHandlerOptions {
	codeagentBaseUrl?: string
	codeagentApiKey?: string
	codeagentModelId?: string
	codeagentModelInfo?: ModelInfo
}
```

**What you can customize:**
- Add additional imports for custom utilities
- Extend `CodeAgentHandlerOptions` with custom fields:
  ```typescript
  interface CodeAgentHandlerOptions extends CommonApiHandlerOptions {
    codeagentBaseUrl?: string
    codeagentApiKey?: string
    codeagentModelId?: string
    codeagentModelInfo?: ModelInfo
    // Add custom options
    codeagentOrganization?: string
    codeagentTimeout?: number
    codeagentCustomHeaders?: Record<string, string>
  }
  ```

#### Section 1.2: Client Initialization (Lines 25-57)

```typescript
private ensureClient(): OpenAI {
  if (!this.client) {
    if (!this.options.codeagentApiKey) {
      throw new Error("CodeAgent API key is required")
    }
    if (!this.options.codeagentBaseUrl) {
      throw new Error("CodeAgent Base URL is required")
    }
    try {
      // Ensure the base URL is properly formatted for OpenAI SDK
      // The OpenAI SDK expects baseURL without /v1 suffix (it adds it automatically)
      let baseUrl = this.options.codeagentBaseUrl.trim()
      // Remove trailing slashes
      baseUrl = baseUrl.replace(/\/+$/, "")
      // Remove /v1 suffix if present (OpenAI SDK adds it)
      if (baseUrl.endsWith("/v1")) {
        baseUrl = baseUrl.slice(0, -3)
      }

      this.client = new OpenAI({
        baseURL: baseUrl,
        apiKey: this.options.codeagentApiKey,
        defaultHeaders: {
          "HTTP-Referer": "https://cline.bot",
          "X-Title": "Cline-CodeAgent",
        },
      })
    } catch (error: any) {
      throw new Error(`Error creating CodeAgent client: ${error.message}`)
    }
  }
  return this.client
}
```

**What you can customize:**

1. **Custom URL processing:**
   ```typescript
   // Add custom domain validation
   if (!baseUrl.includes("your-domain.com")) {
     throw new Error("Only your-domain.com backends are supported")
   }
   
   // Add custom port handling
   if (!baseUrl.includes(":")) {
     baseUrl = `${baseUrl}:8000` // Add default port
   }
   ```

2. **Custom headers:**
   ```typescript
   defaultHeaders: {
     "HTTP-Referer": "https://cline.bot",
     "X-Title": "Cline-CodeAgent",
     "X-Organization": this.options.codeagentOrganization,
     "X-API-Version": "v1",
     ...this.options.codeagentCustomHeaders,
   },
   ```

3. **Timeout configuration:**
   ```typescript
   this.client = new OpenAI({
     baseURL: baseUrl,
     apiKey: this.options.codeagentApiKey,
     timeout: this.options.codeagentTimeout || 60000,
     defaultHeaders: { /* ... */ },
   })
   ```

4. **Custom error messages:**
   ```typescript
   if (!this.options.codeagentApiKey) {
     throw new Error("Please provide your CodeAgent API key in settings")
   }
   ```

#### Section 1.3: Message Creation (Lines 59-84)

```typescript
@withRetry()
async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
  const client = this.ensureClient()
  const modelId = this.options.codeagentModelId ?? ""
  const modelInfo = this.options.codeagentModelInfo as OpenAiCompatibleModelInfo | undefined

  const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...convertToOpenAiMessages(messages),
  ]

  // Use model info if available, otherwise use sane defaults (similar to OpenAI handler)
  const temperature = modelInfo?.temperature ?? openAiModelInfoSaneDefaults.temperature
  const maxTokens = modelInfo?.maxTokens && modelInfo.maxTokens > 0 ? modelInfo.maxTokens : undefined

  const stream = await client.chat.completions.create({
    model: modelId,
    messages: openAiMessages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  })
```

**What you can customize:**

1. **Additional request parameters:**
   ```typescript
   const stream = await client.chat.completions.create({
     model: modelId,
     messages: openAiMessages,
     temperature,
     max_tokens: maxTokens,
     stream: true,
     stream_options: { include_usage: true },
     // Add custom parameters
     top_p: modelInfo?.topP ?? 1.0,
     frequency_penalty: modelInfo?.frequencyPenalty ?? 0,
     presence_penalty: modelInfo?.presencePenalty ?? 0,
     stop: modelInfo?.stopSequences,
   })
   ```

2. **Custom message formatting:**
   ```typescript
   // Add custom message preprocessing
   const processedMessages = openAiMessages.map(msg => ({
     ...msg,
     // Add custom metadata
     metadata: { source: "cline", timestamp: Date.now() }
   }))
   ```

3. **Model-specific logic:**
   ```typescript
   // Different parameters for different models
   let temperature = modelInfo?.temperature ?? openAiModelInfoSaneDefaults.temperature
   
   if (modelId.includes("reasoning")) {
     temperature = undefined // Reasoning models don't use temperature
   }
   ```

#### Section 1.4: Response Processing (Lines 86-119)

```typescript
let lastUsage: OpenAI.CompletionUsage | undefined

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta
  if (delta?.content) {
    yield {
      type: "text",
      text: delta.content,
    }
  }

  if (chunk.usage) {
    lastUsage = chunk.usage
  }
}

if (lastUsage) {
  const inputTokens = lastUsage.prompt_tokens || 0
  const outputTokens = lastUsage.completion_tokens || 0
  // Support for prompt caching if the backend provides it
  const cacheWriteTokens = (lastUsage as any).prompt_tokens_details?.caching_tokens || undefined
  const cacheReadTokens = (lastUsage as any).prompt_tokens_details?.cached_tokens || undefined
  
  const model = this.getModel()
  const totalCost = calculateApiCostOpenAI(model.info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

  yield {
    type: "usage",
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    cacheWriteTokens: cacheWriteTokens,
    cacheReadTokens: cacheReadTokens,
    totalCost: totalCost,
  }
}
```

**What you can customize:**

1. **Custom usage extraction:**
   ```typescript
   // If your backend uses different field names
   const cacheWriteTokens = 
     (lastUsage as any).cache_creation_tokens ||
     (lastUsage as any).prompt_tokens_details?.caching_tokens ||
     undefined
   
   const cacheReadTokens = 
     (lastUsage as any).cache_read_tokens ||
     (lastUsage as any).prompt_tokens_details?.cached_tokens ||
     undefined
   ```

2. **Additional metrics:**
   ```typescript
   yield {
     type: "usage",
     inputTokens: inputTokens,
     outputTokens: outputTokens,
     cacheWriteTokens: cacheWriteTokens,
     cacheReadTokens: cacheReadTokens,
     totalCost: totalCost,
     // Add custom metrics
     latency: (lastUsage as any).latency_ms,
     modelVersion: (lastUsage as any).model_version,
   }
   ```

3. **Custom logging:**
   ```typescript
   if (lastUsage) {
     console.log("CodeAgent Usage:", {
       input: inputTokens,
       output: outputTokens,
       cost: totalCost,
       timestamp: new Date().toISOString()
     })
   }
   ```

#### Section 1.5: Model Information (Lines 121-145)

```typescript
getModel(): { id: string; info: ModelInfo } {
  const modelId = this.options.codeagentModelId
  const modelInfo = this.options.codeagentModelInfo
  if (modelId && modelInfo) {
    return { id: modelId, info: modelInfo }
  }
  // Default model info - mimics OpenAI defaults
  // These will be replaced by actual model info fetched from the backend
  return {
    id: modelId || "gpt-4",
    info: {
      maxTokens: openAiModelInfoSaneDefaults.maxTokens,
      contextWindow: 128000,
      supportsImages: true,
      supportsPromptCache: false,
      inputPrice: 0,
      outputPrice: 0,
      description: "CodeAgent model",
    },
  }
}
```

**What you can customize:**

1. **Default model configuration:**
   ```typescript
   return {
     id: modelId || "your-default-model",
     info: {
       maxTokens: 16384, // Your default
       contextWindow: 200000, // Your default
       supportsImages: true,
       supportsPromptCache: true, // If your backend supports it
       inputPrice: 0.001, // Your pricing
       outputPrice: 0.003, // Your pricing
       description: "Custom CodeAgent model",
     },
   }
   ```

2. **Model-specific defaults:**
   ```typescript
   if (modelId?.includes("vision")) {
     return {
       id: modelId,
       info: {
         supportsImages: true,
         maxTokens: 4096,
         // Vision model defaults
       }
     }
   }
   ```

---

### 2. Model Fetching Controller

**File:** `src/core/controller/models/refreshCodeAgentModels.ts`
**Lines:** 1-95
**Purpose:** Fetch and parse model list from backend

#### Section 2.1: Core Fetch Logic (Lines 1-30)

```typescript
import type { ModelInfo } from "@shared/api"
import { GlobalFileNames } from "../../storage/disk"

export async function refreshCodeAgentModels(
	baseURL?: string,
	apiKey?: string,
): Promise<Record<string, ModelInfo>> {
	if (!baseURL || !apiKey) {
		throw new Error("CodeAgent Base URL and API Key are required to fetch models")
	}

	try {
		const response = await fetch(`${baseURL}/v1/models`, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
		})

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = await response.json()
```

**What you can customize:**

1. **Custom endpoint:**
   ```typescript
   // If your backend uses a different endpoint
   const response = await fetch(`${baseURL}/api/models`, {
     // ...
   })
   
   // Or with query parameters
   const response = await fetch(`${baseURL}/v1/models?include_details=true`, {
     // ...
   })
   ```

2. **Additional headers:**
   ```typescript
   const response = await fetch(`${baseURL}/v1/models`, {
     headers: {
       Authorization: `Bearer ${apiKey}`,
       "Content-Type": "application/json",
       "X-API-Version": "v1",
       "Accept": "application/json",
     },
   })
   ```

3. **Timeout handling:**
   ```typescript
   const controller = new AbortController()
   const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout
   
   try {
     const response = await fetch(`${baseURL}/v1/models`, {
       headers: { /* ... */ },
       signal: controller.signal,
     })
     clearTimeout(timeoutId)
   } catch (error) {
     if (error.name === 'AbortError') {
       throw new Error("Request timed out")
     }
     throw error
   }
   ```

#### Section 2.2: Field Mapping (Lines 30-80)

```typescript
const models: Record<string, ModelInfo> = {}

// Support different response structures
const modelList = data.data || data.models || data

if (!Array.isArray(modelList)) {
  throw new Error("Invalid models response format")
}

for (const model of modelList) {
  // Get model ID from various possible field names
  const modelId = model.id || model.model_id || model.name

  if (!modelId) {
    console.warn("Skipping model without ID:", model)
    continue
  }

  // Extract model information with fallbacks
  const maxTokens =
    model.max_tokens ||
    model.maxTokens ||
    model.max_completion_tokens ||
    8192

  const contextWindow =
    model.context_window ||
    model.contextWindow ||
    model.context_length ||
    model.max_context_length ||
    128000

  const supportsImages =
    model.supports_images ??
    model.supportsImages ??
    model.vision ??
    model.multimodal ??
    true

  const supportsPromptCache =
    model.supports_prompt_cache ??
    model.supportsPromptCache ??
    false

  const inputPrice =
    model.input_price ??
    model.inputPrice ??
    model.prompt_price ??
    0

  const outputPrice =
    model.output_price ??
    model.outputPrice ??
    model.completion_price ??
    0

  const description =
    model.description ||
    model.desc ||
    `${modelId}`

  models[modelId] = {
    maxTokens,
    contextWindow,
    supportsImages,
    supportsPromptCache,
    inputPrice,
    outputPrice,
    description,
  }
}
```

**What you can customize:**

1. **Add custom fields:**
   ```typescript
   // Extend ModelInfo to include custom fields
   models[modelId] = {
     maxTokens,
     contextWindow,
     supportsImages,
     supportsPromptCache,
     inputPrice,
     outputPrice,
     description,
     // Add custom fields
     temperature: model.default_temperature ?? 0,
     topP: model.default_top_p ?? 1.0,
     capabilities: model.capabilities || [],
     modelFamily: model.family || "unknown",
   }
   ```

2. **Custom field extraction:**
   ```typescript
   // If your backend uses completely different field names
   const maxTokens =
     model.max_output_length ||
     model.response_token_limit ||
     8192
   
   const inputPrice =
     model.pricing?.input ||
     model.cost?.prompt ||
     0
   ```

3. **Model filtering:**
   ```typescript
   for (const model of modelList) {
     const modelId = model.id || model.model_id || model.name
     
     // Skip certain models
     if (modelId.includes("deprecated")) {
       continue
     }
     
     // Only include specific models
     if (!modelId.startsWith("your-prefix-")) {
       continue
     }
     
     // Filter by capability
     if (!model.capabilities?.includes("chat")) {
       continue
     }
     
     // ... rest of extraction
   }
   ```

4. **Pricing calculation:**
   ```typescript
   // If your backend uses different pricing structure
   const inputPrice = model.pricing?.input_per_1k
     ? model.pricing.input_per_1k / 1000 // Convert to per-million
     : 0
   
   const outputPrice = model.pricing?.output_per_1k
     ? model.pricing.output_per_1k / 1000
     : 0
   ```

#### Section 2.3: Caching (Lines 80-95)

```typescript
// Cache the models to disk
const fs = await import("fs/promises")
const path = await import("path")

await controller.stateManager.storageManager.ensureGlobalDirectoryExists()
const modelsPath = path.join(
  controller.stateManager.storageManager.getGlobalStoragePath(),
  GlobalFileNames.codeagentModels,
)

await fs.writeFile(modelsPath, JSON.stringify(models, null, 2))

return models
```

**What you can customize:**

1. **Cache duration:**
   ```typescript
   // Add timestamp to cache
   const cacheData = {
     timestamp: Date.now(),
     models: models,
   }
   await fs.writeFile(modelsPath, JSON.stringify(cacheData, null, 2))
   
   // Check cache age before fetching
   const cacheAge = Date.now() - cacheData.timestamp
   if (cacheAge < 3600000) { // 1 hour
     return cacheData.models
   }
   ```

2. **Error handling:**
   ```typescript
   try {
     await fs.writeFile(modelsPath, JSON.stringify(models, null, 2))
   } catch (error) {
     console.error("Failed to cache models:", error)
     // Continue without caching
   }
   ```

---

## Frontend UI Files

### 3. CodeAgent Provider Component

**File:** `webview-ui/src/components/settings/providers/CodeAgentProvider.tsx`
**Lines:** 1-110
**Purpose:** Settings UI for CodeAgent configuration

#### Section 3.1: State and Handlers (Lines 1-45)

```typescript
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { validateApiConfiguration } from "../../../utils/validate"
import CodeAgentModelPicker from "../CodeAgentModelPicker"
import { vscode } from "../../../utils/vscode"
import type { ApiConfiguration } from "@shared/api"

interface CodeAgentProviderProps {
	apiConfiguration?: ApiConfiguration
	setApiConfiguration: (config: ApiConfiguration) => void
}

const CodeAgentProvider = ({ apiConfiguration, setApiConfiguration }: CodeAgentProviderProps) => {
	const { mode } = useExtensionState()

	const handleInputChange = (field: keyof ApiConfiguration) => (e: any) => {
		const value = e.target.value
		setApiConfiguration({
			...apiConfiguration,
			[field]: value,
		})
	}
```

**What you can customize:**

1. **Add custom fields:**
   ```typescript
   // Add organization field
   <VSCodeTextField
     value={apiConfiguration?.codeagentOrganization || ""}
     placeholder="your-organization"
     onInput={handleInputChange("codeagentOrganization")}
   >
     <span className="...">Organization ID (Optional)</span>
   </VSCodeTextField>
   ```

2. **Custom validation:**
   ```typescript
   const handleInputChange = (field: keyof ApiConfiguration) => (e: any) => {
     let value = e.target.value
     
     // Custom validation/transformation
     if (field === "codeagentBaseUrl") {
       // Auto-add https://
       if (value && !value.startsWith("http")) {
         value = `https://${value}`
       }
     }
     
     setApiConfiguration({
       ...apiConfiguration,
       [field]: value,
     })
   }
   ```

#### Section 3.2: UI Components (Lines 45-110)

```typescript
return (
  <div className="...">
    <div className="...">
      <VSCodeTextField
        value={apiConfiguration?.codeagentBaseUrl || ""}
        style={{ width: "100%" }}
        placeholder="http://localhost:8000"
        onInput={handleInputChange("codeagentBaseUrl")}
      >
        <span className="...">
          CodeAgent Base URL
          <span className="..."> *</span>
        </span>
      </VSCodeTextField>
      <p className="...">
        The base URL of your CodeAgent backend (e.g., http://localhost:8000 or
        https://api.your-backend.com)
      </p>
    </div>

    <div className="...">
      <VSCodeTextField
        value={apiConfiguration?.codeagentApiKey || ""}
        style={{ width: "100%" }}
        type="password"
        placeholder="sk-..."
        onInput={handleInputChange("codeagentApiKey")}
      >
        <span className="...">
          CodeAgent API Key
          <span className="..."> *</span>
        </span>
      </VSCodeTextField>
      <p className="...">
        Your API key for authenticating with the CodeAgent backend
      </p>
    </div>

    <div className="...">
      <CodeAgentModelPicker
        key={`codeagent-${mode}`}
        mode={mode}
        modelId={currentModelId}
        modelInfo={currentModelInfo}
        onSelect={handleModelSelect}
        apiConfiguration={apiConfiguration}
        setApiConfiguration={setApiConfiguration}
      />
    </div>
  </div>
)
```

**What you can customize:**

1. **Change placeholders and help text:**
   ```typescript
   <VSCodeTextField
     value={apiConfiguration?.codeagentBaseUrl || ""}
     placeholder="https://api.mycompany.com"  // Your default
     onInput={handleInputChange("codeagentBaseUrl")}
   >
     <span className="...">
       MyCompany API Endpoint  {/* Your label */}
     </span>
   </VSCodeTextField>
   <p className="...">
     Enter your company's API endpoint URL
   </p>
   ```

2. **Add validation indicators:**
   ```typescript
   const [isValidUrl, setIsValidUrl] = useState(true)
   
   const handleUrlChange = (e: any) => {
     const value = e.target.value
     try {
       new URL(value)
       setIsValidUrl(true)
     } catch {
       setIsValidUrl(false)
     }
     handleInputChange("codeagentBaseUrl")(e)
   }
   
   <VSCodeTextField
     value={apiConfiguration?.codeagentBaseUrl || ""}
     onInput={handleUrlChange}
     className={isValidUrl ? "" : "error"}
   >
     <span>CodeAgent Base URL</span>
   </VSCodeTextField>
   {!isValidUrl && <p className="error">Invalid URL format</p>}
   ```

3. **Add test connection button:**
   ```typescript
   const testConnection = async () => {
     try {
       const response = await fetch(
         `${apiConfiguration?.codeagentBaseUrl}/v1/models`,
         {
           headers: {
             Authorization: `Bearer ${apiConfiguration?.codeagentApiKey}`,
           },
         }
       )
       if (response.ok) {
         vscode.postMessage({
           type: "showInformationMessage",
           text: "✓ Connection successful!",
         })
       } else {
         throw new Error(`HTTP ${response.status}`)
       }
     } catch (error) {
       vscode.postMessage({
         type: "showErrorMessage",
         text: `✗ Connection failed: ${error.message}`,
       })
     }
   }
   
   <VSCodeButton onClick={testConnection}>
     Test Connection
   </VSCodeButton>
   ```

---

### 4. Model Picker Component

**File:** `webview-ui/src/components/settings/CodeAgentModelPicker.tsx`
**Lines:** 1-250
**Purpose:** Searchable dropdown for model selection

#### Section 4.1: Search Configuration (Lines 40-60)

```typescript
const fuse = useMemo(() => {
  const modelArray = Object.entries(codeagentModels).map(([id, info]) => ({
    id,
    info,
  }))

  return new Fuse(modelArray, {
    keys: ["id", "info.description"],
    threshold: 0.3,
    includeScore: true,
  })
}, [codeagentModels])
```

**What you can customize:**

1. **Search configuration:**
   ```typescript
   return new Fuse(modelArray, {
     keys: [
       { name: "id", weight: 2 },              // Prioritize ID matches
       { name: "info.description", weight: 1 },
       { name: "info.modelFamily", weight: 1.5 }, // Custom field
     ],
     threshold: 0.2,  // Stricter matching
     includeScore: true,
     shouldSort: true,
     minMatchCharLength: 2,
   })
   ```

2. **Custom sorting:**
   ```typescript
   const sortedModels = useMemo(() => {
     return Object.entries(codeagentModels)
       .sort(([aId, aInfo], [bId, bInfo]) => {
         // Sort by context window (descending)
         return (bInfo.contextWindow || 0) - (aInfo.contextWindow || 0)
         
         // Or sort by name
         return aId.localeCompare(bId)
         
         // Or custom priority
         if (aId.includes("premium")) return -1
         if (bId.includes("premium")) return 1
         return 0
       })
   }, [codeagentModels])
   ```

#### Section 4.2: Model Display (Lines 150-200)

```typescript
<div className="model-item">
  <div className="model-id">{model.id}</div>
  {model.info.description && (
    <div className="model-description">
      {model.info.description}
    </div>
  )}
  <div className="model-metadata">
    {model.info.contextWindow && (
      <span className="model-metadata-item">
        {(model.info.contextWindow / 1000).toFixed(0)}k context
      </span>
    )}
    {model.info.maxTokens && (
      <span className="model-metadata-item">
        {(model.info.maxTokens / 1000).toFixed(0)}k max output
      </span>
    )}
  </div>
</div>
```

**What you can customize:**

1. **Display format:**
   ```typescript
   <div className="model-item">
     {/* Add icon based on capabilities */}
     {model.info.supportsImages && <span>📷</span>}
     {model.info.supportsPromptCache && <span>⚡</span>}
     
     <div className="model-id-container">
       <div className="model-id">{model.id}</div>
       {/* Add badge for new models */}
       {model.info.isNew && <span className="badge">NEW</span>}
     </div>
     
     {/* Custom description */}
     <div className="model-description">
       {model.info.description || `${model.id} - AI Model`}
     </div>
     
     {/* Enhanced metadata */}
     <div className="model-metadata">
       <span>🧠 {(model.info.contextWindow / 1000).toFixed(0)}k</span>
       <span>⚡ {(model.info.maxTokens / 1000).toFixed(0)}k</span>
       {model.info.inputPrice > 0 && (
         <span>💰 ${model.info.inputPrice.toFixed(3)}/M</span>
       )}
       {/* Add model family */}
       {model.info.modelFamily && (
         <span className="family">{model.info.modelFamily}</span>
       )}
     </div>
   </div>
   ```

2. **Grouping models:**
   ```typescript
   const groupedModels = useMemo(() => {
     const groups: Record<string, Array<{id: string, info: ModelInfo}>> = {}
     
     Object.entries(codeagentModels).forEach(([id, info]) => {
       const family = info.modelFamily || "Other"
       if (!groups[family]) groups[family] = []
       groups[family].push({ id, info })
     })
     
     return groups
   }, [codeagentModels])
   
   // Render
   {Object.entries(groupedModels).map(([family, models]) => (
     <div key={family} className="model-group">
       <div className="group-header">{family}</div>
       {models.map(model => (
         <div key={model.id} className="model-item">
           {/* ... */}
         </div>
       ))}
     </div>
   ))}
   ```

---

## Type Definitions

### 5. Shared API Types

**File:** `src/shared/api.ts`
**Lines:** 50-100, 213-240, 3400-3500
**Purpose:** TypeScript type definitions

#### Section 5.1: Provider Enum (Lines 50-90)

```typescript
export type ApiProvider =
	// ... other providers
	| "codeagent"
```

**What you can customize:**
- Provider name (must match across all files)

#### Section 5.2: Configuration Interface (Lines 3400-3500)

```typescript
export interface ApiConfiguration {
	// ... other fields
	codeagentApiKey?: string
	codeagentBaseUrl?: string
	
	// Plan mode
	planModeCodeagentModelId?: string
	planModeCodeagentModelInfo?: ModelInfo
	
	// Act mode
	actModeCodeagentModelId?: string
	actModeCodeagentModelInfo?: ModelInfo
}
```

**What you can customize:**

Add custom fields:
```typescript
export interface ApiConfiguration {
	// Existing fields
	codeagentApiKey?: string
	codeagentBaseUrl?: string
	
	// Add custom fields
	codeagentOrganization?: string
	codeagentTimeout?: number
	codeagentRetryAttempts?: number
	codeagentCustomHeaders?: Record<string, string>
	
	// Mode-specific configs
	planModeCodeagentModelId?: string
	planModeCodeagentModelInfo?: ModelInfo
	actModeCodeagentModelId?: string
	actModeCodeagentModelInfo?: ModelInfo
}
```

#### Section 5.3: Model Info Interface (Lines 213-240)

```typescript
export interface ModelInfo {
	maxTokens?: number
	contextWindow?: number
	supportsImages?: boolean
	supportsPromptCache: boolean
	inputPrice?: number
	outputPrice?: number
	thinkingConfig?: {
		maxBudget?: number
		outputPrice?: number
		outputPriceTiers?: PriceTier[]
	}
	supportsGlobalEndpoint?: boolean
	cacheWritesPrice?: number
	cacheReadsPrice?: number
	description?: string
	tiers?: {
		contextWindow: number
		inputPrice?: number
		outputPrice?: number
		cacheWritesPrice?: number
		cacheReadsPrice?: number
	}[]
}

export interface OpenAiCompatibleModelInfo extends ModelInfo {
	temperature?: number
	isR1FormatRequired?: boolean
}
```

**What you can customize:**

Extend with custom fields:
```typescript
export interface CodeAgentModelInfo extends OpenAiCompatibleModelInfo {
	// Add CodeAgent-specific fields
	modelFamily?: "gpt" | "claude" | "custom"
	capabilities?: string[]
	isNew?: boolean
	releaseDate?: string
	maxBatchSize?: number
	defaultSystemPrompt?: string
}

// Use in ApiConfiguration
export interface ApiConfiguration {
	// ...
	planModeCodeagentModelInfo?: CodeAgentModelInfo
	actModeCodeagentModelInfo?: CodeAgentModelInfo
}
```

---

## Proto Definitions

### 6. Protocol Buffer Schema

**File:** `proto/cline/models.proto`
**Lines:** 76-77, 133-134, 233-234, ~280
**Purpose:** Data structure for serialization

#### Current CodeAgent Fields:

```protobuf
message ModelsApiConfiguration {
  // Global configuration (lines 76-77)
  optional string codeagent_api_key = 76;
  optional string codeagent_base_url = 77;
  
  // Plan mode (lines 133-134)
  optional string plan_mode_codeagent_model_id = 133;
  optional OpenRouterModelInfo plan_mode_codeagent_model_info = 134;
  
  // Act mode (lines 233-234)
  optional string act_mode_codeagent_model_id = 233;
  optional OpenRouterModelInfo act_mode_codeagent_model_info = 234;
}

// Service definition (around line 280)
service ModelsService {
  rpc refreshCodeAgentModels(google.protobuf.Empty) returns (google.protobuf.StringValue);
}
```

**What you can customize:**

1. **Add global fields:**
   ```protobuf
   message ModelsApiConfiguration {
     // Existing
     optional string codeagent_api_key = 76;
     optional string codeagent_base_url = 77;
     
     // Add new fields (use next available numbers)
     optional string codeagent_organization = 78;
     optional int32 codeagent_timeout = 79;
     optional int32 codeagent_retry_attempts = 80;
   }
   ```

2. **Add mode-specific fields:**
   ```protobuf
   // Plan mode
   optional string plan_mode_codeagent_model_id = 133;
   optional OpenRouterModelInfo plan_mode_codeagent_model_info = 134;
   optional int32 plan_mode_codeagent_temperature = 135;  // New
   optional int32 plan_mode_codeagent_max_retries = 136;  // New
   ```

**Important:** After modifying proto files, run:
```bash
npm run protos
```

---

## State Management

### 7. Extension State Context

**File:** `webview-ui/src/context/ExtensionStateContext.tsx`
**Lines:** 80-100, 200-220
**Purpose:** Global state management

#### Section 7.1: State Interface (Lines 80-100)

```typescript
export interface ExtensionState {
	// ... other state
	codeagentModels: Record<string, ModelInfo>
}
```

**What you can customize:**

Add custom state:
```typescript
export interface ExtensionState {
	// Existing
	codeagentModels: Record<string, ModelInfo>
	
	// Add custom state
	codeagentConnectionStatus: "connected" | "disconnected" | "testing"
	codeagentLastFetch: number
	codeagentModelGroups: Record<string, string[]>
}
```

#### Section 7.2: Setters (Lines 200-220)

```typescript
const setCodeAgentModels = useCallback((models: Record<string, ModelInfo>) => {
	setState((prevState) => ({
		...prevState,
		codeagentModels: models,
	}))
}, [])
```

**What you can customize:**

Add custom setters:
```typescript
const setCodeAgentConnectionStatus = useCallback(
	(status: "connected" | "disconnected" | "testing") => {
		setState((prevState) => ({
			...prevState,
			codeagentConnectionStatus: status,
		}))
	},
	[]
)

const updateCodeAgentLastFetch = useCallback(() => {
	setState((prevState) => ({
		...prevState,
		codeagentLastFetch: Date.now(),
	}))
}, [])
```

---

## Utility Files

### 8. Validation

**File:** `webview-ui/src/utils/validate.ts`
**Lines:** 60-80
**Purpose:** Input validation

```typescript
case "codeagent":
	if (!apiConfiguration.codeagentBaseUrl?.trim()) {
		return "CodeAgent Base URL is required"
	}
	if (!apiConfiguration.codeagentApiKey?.trim()) {
		return "CodeAgent API Key is required"
	}
	break
```

**What you can customize:**

1. **Enhanced validation:**
   ```typescript
   case "codeagent":
     // URL validation
     if (!apiConfiguration.codeagentBaseUrl?.trim()) {
       return "CodeAgent Base URL is required"
     }
     
     // URL format validation
     try {
       const url = new URL(apiConfiguration.codeagentBaseUrl)
       if (!url.protocol.startsWith('http')) {
         return "CodeAgent Base URL must use HTTP or HTTPS"
       }
     } catch {
       return "Invalid CodeAgent Base URL format"
     }
     
     // API key validation
     if (!apiConfiguration.codeagentApiKey?.trim()) {
       return "CodeAgent API Key is required"
     }
     
     if (apiConfiguration.codeagentApiKey.length < 10) {
       return "CodeAgent API Key appears to be invalid"
     }
     
     // Custom field validation
     if (apiConfiguration.codeagentOrganization) {
       if (!/^[a-z0-9-]+$/.test(apiConfiguration.codeagentOrganization)) {
         return "Organization ID can only contain lowercase letters, numbers, and hyphens"
       }
     }
     
     break
   ```

2. **Async validation:**
   ```typescript
   // For testing connection during validation
   const testCodeAgentConnection = async (config: ApiConfiguration) => {
     try {
       const response = await fetch(`${config.codeagentBaseUrl}/v1/models`, {
         headers: {
           Authorization: `Bearer ${config.codeagentApiKey}`,
         },
       })
       return response.ok
     } catch {
       return false
     }
   }
   ```

---

### 9. Provider Utilities

**File:** `webview-ui/src/components/settings/utils/providerUtils.ts`
**Lines:** 150-200
**Purpose:** Provider field management

```typescript
export const providerFields: Record<ApiProvider, string[]> = {
	// ... other providers
	codeagent: [
		"codeagentApiKey",
		"codeagentBaseUrl",
	],
}
```

**What you can customize:**

Add custom fields:
```typescript
export const providerFields: Record<ApiProvider, string[]> = {
	codeagent: [
		"codeagentApiKey",
		"codeagentBaseUrl",
		// Add custom fields
		"codeagentOrganization",
		"codeagentTimeout",
		"codeagentRetryAttempts",
	],
}
```

---

### 10. Storage/Caching

**File:** `src/core/storage/disk.ts`
**Lines:** 40-50
**Purpose:** File storage configuration

```typescript
export const GlobalFileNames = {
	// ... other files
	codeagentModels: "codeagent_models.json",
}
```

**What you can customize:**

Add custom cache files:
```typescript
export const GlobalFileNames = {
	codeagentModels: "codeagent_models.json",
	// Add custom cache files
	codeagentConfig: "codeagent_config.json",
	codeagentMetrics: "codeagent_metrics.json",
}
```

---

## Complete Customization Workflow

### Example: Adding a Custom "Organization" Field

#### Step 1: Add TypeScript Type
```typescript
// File: src/shared/api.ts
export interface ApiConfiguration {
	// ... existing
	codeagentOrganization?: string
}
```

#### Step 2: Add Proto Definition
```protobuf
// File: proto/cline/models.proto
message ModelsApiConfiguration {
	// ... existing
	optional string codeagent_organization = 78;
}
```

#### Step 3: Regenerate Proto
```bash
npm run protos
```

#### Step 4: Add Conversion
```typescript
// File: src/shared/proto-conversions/models/api-configuration-conversion.ts

// In convertApiConfigurationToProto:
codeagentOrganization: config.codeagentOrganization,

// In convertProtoToApiConfiguration:
codeagentOrganization: protoConfig.codeagentOrganization,
```

#### Step 5: Add UI Field
```typescript
// File: webview-ui/src/components/settings/providers/CodeAgentProvider.tsx
<VSCodeTextField
	value={apiConfiguration?.codeagentOrganization || ""}
	placeholder="my-org"
	onInput={handleInputChange("codeagentOrganization")}
>
	<span>Organization (Optional)</span>
</VSCodeTextField>
```

#### Step 6: Use in Handler
```typescript
// File: src/core/api/providers/codeagent.ts
interface CodeAgentHandlerOptions extends CommonApiHandlerOptions {
	codeagentOrganization?: string
}

// In ensureClient():
defaultHeaders: {
	"X-Organization": this.options.codeagentOrganization,
}
```

#### Step 7: Add to Provider Utils
```typescript
// File: webview-ui/src/components/settings/utils/providerUtils.ts
export const providerFields: Record<ApiProvider, string[]> = {
	codeagent: [
		"codeagentApiKey",
		"codeagentBaseUrl",
		"codeagentOrganization",
	],
}
```

---

## Summary: All Customizable Files

### Backend (7 files)
1. ✅ `src/core/api/providers/codeagent.ts` - API handler
2. ✅ `src/core/controller/models/refreshCodeAgentModels.ts` - Model fetching
3. ✅ `src/core/api/index.ts` - Provider switch case
4. ✅ `src/core/storage/disk.ts` - Cache configuration
5. ✅ `src/shared/api.ts` - Type definitions
6. ✅ `src/shared/proto-conversions/models/api-configuration-conversion.ts` - Proto conversions
7. ✅ `proto/cline/models.proto` - Proto schema

### Frontend (6 files)
1. ✅ `webview-ui/src/components/settings/providers/CodeAgentProvider.tsx` - Settings UI
2. ✅ `webview-ui/src/components/settings/CodeAgentModelPicker.tsx` - Model picker
3. ✅ `webview-ui/src/components/settings/ApiOptions.tsx` - Provider list
4. ✅ `webview-ui/src/components/welcome/WelcomeView.tsx` - Welcome text
5. ✅ `webview-ui/src/context/ExtensionStateContext.tsx` - State management
6. ✅ `webview-ui/src/utils/validate.ts` - Validation
7. ✅ `webview-ui/src/components/settings/utils/providerUtils.ts` - Provider utils

---

**Last Updated:** 2025-10-05
**Total Customizable Files:** 13
**Proto Regeneration Required:** After modifying `.proto` files, run `npm run protos`
