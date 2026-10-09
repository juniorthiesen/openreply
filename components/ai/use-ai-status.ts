"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/components/scheduling/shared";

export interface AiStatus {
  enabled: boolean;
  remaining?: number;
  limit?: number;
}

/** Whether the AI assistant is on for this workspace. Null while it is still loading. */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    apiRequest<AiStatus>("/api/ai/status")
      .then((data) => { if (mounted) setStatus(data); })
      .catch(() => { if (mounted) setStatus({ enabled: false }); });
    return () => { mounted = false; };
  }, []);

  return status;
}
