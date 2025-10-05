import { EmptyRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse from "fuse.js"
import React, { KeyboardEvent, memo, useEffect, useMemo, useRef, useState } from "react"
import { useMount } from "react-use"
import styled from "styled-components"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ModelsServiceClient } from "../../services/grpc-client"
import { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"
import { highlight } from "../history/HistoryView"
import { ModelInfoView } from "./common/ModelInfoView"
import { getModeSpecificFields, normalizeApiConfiguration } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

export interface CodeAgentModelPickerProps {
	isPopup?: boolean
	baseUrl?: string
	currentMode: Mode
}

const CodeAgentModelPicker: React.FC<CodeAgentModelPickerProps> = ({ isPopup, baseUrl, currentMode }) => {
	const { apiConfiguration, codeagentModels, setCodeAgentModels } = useExtensionState()
	const { handleModeFieldsChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const [searchTerm, setSearchTerm] = useState(modeFields.codeagentModelId || "")
	const [isDropdownVisible, setIsDropdownVisible] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const itemRefs = useRef<(HTMLDivElement | null)[]>([])
	const dropdownListRef = useRef<HTMLDivElement>(null)

	const handleModelChange = (newModelId: string) => {
		handleModeFieldsChange(
			{
				codeagentModelId: {
					plan: "planModeCodeagentModelId",
					act: "actModeCodeagentModelId",
				},
				codeagentModelInfo: {
					plan: "planModeCodeagentModelInfo",
					act: "actModeCodeagentModelInfo",
				},
			},
			{
				codeagentModelId: newModelId,
				codeagentModelInfo: codeagentModels[newModelId],
			},
			currentMode,
		)
		setSearchTerm(newModelId)
	}

	const { selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration, currentMode)
	}, [apiConfiguration, currentMode])

	useMount(() => {
		ModelsServiceClient.refreshCodeAgentModels(EmptyRequest.create({}))
			.then((response) => {
				setCodeAgentModels(response.models)
			})
			.catch((err) => {
				console.error("Failed to refresh CodeAgent models:", err)
			})
	})

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsDropdownVisible(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [])

	const modelIds = useMemo(() => {
		return Object.keys(codeagentModels).sort((a, b) => a.localeCompare(b))
	}, [codeagentModels])

	const searchableItems = useMemo(() => {
		return modelIds.map((id) => ({
			id,
			html: id,
		}))
	}, [modelIds])

	const fuse = useMemo(() => {
		return new Fuse(searchableItems, {
			keys: ["html"],
			threshold: 0.6,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [searchableItems])

	const modelSearchResults = useMemo(() => {
		const results: { id: string; html: string }[] = searchTerm
			? highlight(fuse.search(searchTerm), "model-item-highlight")
			: searchableItems
		return results
	}, [searchableItems, searchTerm, fuse])

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!isDropdownVisible) {
			return
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault()
				setSelectedIndex((prev) => (prev < modelSearchResults.length - 1 ? prev + 1 : prev))
				break
			case "ArrowUp":
				event.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev))
				break
			case "Enter":
				event.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < modelSearchResults.length) {
					handleModelChange(modelSearchResults[selectedIndex].id)
					setIsDropdownVisible(false)
				}
				break
			case "Escape":
				setIsDropdownVisible(false)
				setSelectedIndex(-1)
				break
		}
	}

	useEffect(() => {
		if (selectedIndex >= 0 && itemRefs.current[selectedIndex] && dropdownListRef.current) {
			const selectedItem = itemRefs.current[selectedIndex]
			const container = dropdownListRef.current

			if (selectedItem) {
				const itemTop = selectedItem.offsetTop
				const itemBottom = itemTop + selectedItem.offsetHeight
				const containerTop = container.scrollTop
				const containerBottom = containerTop + container.clientHeight

				if (itemBottom > containerBottom) {
					container.scrollTop = itemBottom - container.clientHeight
				} else if (itemTop < containerTop) {
					container.scrollTop = itemTop
				}
			}
		}
	}, [selectedIndex])

	return (
		<Container>
			<label htmlFor="codeagent-model-id">
				<span style={{ fontWeight: 500 }}>Model</span>
			</label>
			<div ref={dropdownRef} style={{ position: "relative" }}>
				<VSCodeTextField
					id="codeagent-model-id"
					onFocus={() => setIsDropdownVisible(true)}
					onInput={(e: any) => {
						setSearchTerm(e.target.value)
						setIsDropdownVisible(true)
					}}
					onKeyDown={handleKeyDown}
					placeholder="Search models..."
					style={{ width: "100%" }}
					value={searchTerm}
				/>

				{isDropdownVisible && modelIds.length > 0 && (
					<DropdownList ref={dropdownListRef}>
						{modelSearchResults.map((model, index) => (
							<DropdownItem
								dangerouslySetInnerHTML={{ __html: model.html }}
								isSelected={index === selectedIndex}
								key={model.id}
								onClick={() => {
									handleModelChange(model.id)
									setIsDropdownVisible(false)
								}}
								onMouseEnter={() => setSelectedIndex(index)}
								ref={(el) => (itemRefs.current[index] = el)}
							/>
						))}
					</DropdownList>
				)}

				{isDropdownVisible && modelIds.length === 0 && (
					<DropdownList>
						<DropdownItem isSelected={false}>
							<span style={{ opacity: 0.5 }}>
								{baseUrl
									? "No models available. Please check your API key and base URL."
									: "Please enter a base URL to load models."}
							</span>
						</DropdownItem>
					</DropdownList>
				)}
			</div>

			<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
		</Container>
	)
}

const Container = styled.div`
	display: flex;
	flex-direction: column;
	gap: 5px;
`

const DropdownList = styled.div`
	position: absolute;
	top: 100%;
	left: 0;
	right: 0;
	max-height: 300px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-dropdown-border);
	border-radius: 3px;
	margin-top: 2px;
	z-index: 1000;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
`

const DropdownItem = styled.div<{ isSelected: boolean }>`
	padding: 8px 12px;
	cursor: pointer;
	background-color: ${(props) =>
		props.isSelected ? "var(--vscode-list-hoverBackground)" : "var(--vscode-dropdown-background)"};
	color: ${(props) => (props.isSelected ? "var(--vscode-list-hoverForeground)" : "var(--vscode-dropdown-foreground)")};

	&:hover {
		background-color: var(--vscode-list-hoverBackground);
		color: var(--vscode-list-hoverForeground);
	}

	mark {
		background-color: ${CODE_BLOCK_BG_COLOR};
		color: inherit;
		font-weight: 600;
	}
`

export default memo(CodeAgentModelPicker)
