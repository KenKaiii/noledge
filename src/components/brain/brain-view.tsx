"use client";

import { Brain, Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import type { BrainGraph } from "@/lib/ai/brain/graph";

// WebGL canvas — never render on the server.
const BrainGraphCanvas = dynamic(
	() => import("./brain-graph").then((mod) => mod.BrainGraph),
	{ ssr: false },
);

export function BrainView(): React.JSX.Element {
	const [graph, setGraph] = useState<BrainGraph | null>(null);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async (): Promise<void> => {
		try {
			const response = await fetch("/api/brain");
			const data = (await response.json()) as BrainGraph;
			setGraph(data);
		} catch {
			setGraph({ nodes: [], links: [], documentCount: 0 });
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	if (loading) {
		return (
			<div className="flex size-full items-center justify-center bg-[#05080d]">
				<Loader2 className="size-6 animate-spin text-cyan-400/70" />
			</div>
		);
	}

	if (!graph || graph.nodes.length === 0) {
		return (
			<div className="flex size-full flex-col items-center justify-center gap-2 bg-[#05080d] text-center">
				<Brain className="size-8 text-cyan-400/60" />
				<p className="text-sm font-medium text-cyan-50">The Brain is empty</p>
				<p className="text-xs text-cyan-200/50">
					Upload documents in Knowledge to grow its connections.
				</p>
			</div>
		);
	}

	return (
		<div className="relative size-full overflow-hidden">
			<div className="pointer-events-none absolute left-6 top-6 z-10">
				<h1 className="text-lg font-semibold tracking-tight text-cyan-50">
					The Brain
				</h1>
				<p className="text-xs text-cyan-200/60">
					{graph.nodes.length} fragments · {graph.links.length} connections ·{" "}
					{graph.documentCount} source
					{graph.documentCount === 1 ? "" : "s"}
				</p>
			</div>
			<BrainGraphCanvas graph={graph} />
		</div>
	);
}
