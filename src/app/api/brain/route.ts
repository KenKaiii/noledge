import { buildBrainGraph } from "@/lib/ai/brain/graph";

/**
 * Returns the knowledge graph: documents as nodes, semantic-similarity edges.
 * Consumed by The Brain view (`react-force-graph-3d`).
 */
export function GET(): Response {
	const graph = buildBrainGraph();
	return Response.json(graph);
}
