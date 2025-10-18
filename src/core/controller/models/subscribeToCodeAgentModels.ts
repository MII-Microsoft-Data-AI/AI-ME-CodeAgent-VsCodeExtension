import { EmptyRequest } from "@shared/proto/cline/common"
import { CodeAgentCompatibleModelInfo } from "@shared/proto/cline/models"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active CodeAgent models subscriptions
const activeCodeAgentModelsSubscriptions = new Set<StreamingResponseHandler<CodeAgentCompatibleModelInfo>>()

/**
 * Subscribe to CodeAgent models events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToCodeAgentModels(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<CodeAgentCompatibleModelInfo>,
	requestId?: string,
): Promise<void> {
	console.log("[DEBUG] set up CodeAgent models subscription")

	// Add this subscription to the active subscriptions
	activeCodeAgentModelsSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeCodeAgentModelsSubscriptions.delete(responseStream)
		console.log("[DEBUG] Cleaned up CodeAgent models subscription")
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "codeagentModels_subscription" }, responseStream)
	}
}

/**
 * Send a CodeAgent models event to all active subscribers
 * @param models The CodeAgent models to send
 */
export async function sendCodeAgentModelsEvent(models: CodeAgentCompatibleModelInfo): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(activeCodeAgentModelsSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				models,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending CodeAgent models to subscriber:", error)
		}
	})

	await Promise.all(promises)
}
