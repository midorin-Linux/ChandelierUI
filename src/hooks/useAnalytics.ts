import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { selectAnalytics } from "../lib/analytics"
import { sessionService } from "../lib/tauri"
import type { LiveGeneration } from "../stores/chat"
import type {
  AppError,
  JsonValue,
  Message,
  SessionDetail,
} from "../types/domain"

function objectValue(value: JsonValue | undefined): {
  [key: string]: JsonValue
} {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {}
}

function textValue(value: JsonValue | undefined) {
  return typeof value === "string" ? value : null
}

export function useAnalytics(
  detail: SessionDetail,
  live: LiveGeneration | null
) {
  const [selection, selectGeneration] = useState<string | null>(null)
  const selected = selectAnalytics(detail, live, selection)
  const { selectedId, generation, output } = selected
  const historicalOutput = useQuery<Message, AppError>({
    queryKey: ["generation-message", detail.session.id, selectedId],
    queryFn: () => {
      if (selectedId === null) throw new Error("生成が選択されていません。")
      return sessionService.generationMessage(selectedId)
    },
    enabled: selectedId !== null && output === null,
    staleTime: Infinity,
    retry: false,
  })
  const snapshot = objectValue(generation?.request_snapshot)
  const body = objectValue(snapshot.body)

  return {
    ...selected,
    selection,
    selectGeneration,
    technical: {
      providerName: textValue(snapshot.provider_name),
      modelName: textValue(snapshot.model_display_name),
      modelIdentifier: textValue(body.model),
      endpointType: textValue(snapshot.endpoint_type),
      baseUrl: textValue(snapshot.base_url),
    },
    output: output ?? historicalOutput.data?.content ?? null,
    outputLoading:
      output === null && selectedId !== null && historicalOutput.isPending,
    outputError: output === null ? historicalOutput.error : null,
    outputRefreshing: historicalOutput.isFetching,
    retryOutput: () => {
      void historicalOutput.refetch()
    },
  }
}
