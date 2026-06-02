"use client";

import { forceCollide } from "d3-force-3d";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, {
	type ForceGraphMethods,
	type NodeObject,
} from "react-force-graph-3d";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import type {
	BrainGraph as BrainGraphData,
	BrainLink,
	BrainNode,
} from "@/lib/ai/brain/graph";

type GraphNode = NodeObject<BrainNode>;
type GraphLink = BrainLink;

const NODE_HOT = "#f0fdff"; // highlighted node — near-white glow
const NODE_DIM = "#1e3a44"; // faded when another node is focused
const LINK_HOT = "#67e8f9"; // active edge
const LINK_DIM = "#0c2a33"; // faded edge

// Neon palette — each source document gets its own colour so clusters read.
const DOC_PALETTE = [
	"#22d3ee", // cyan
	"#34d399", // emerald
	"#a78bfa", // violet
	"#f472b6", // pink
	"#fbbf24", // amber
	"#60a5fa", // blue
	"#f87171", // red
	"#4ade80", // green
] as const;

/** Stable colour per document id, cycling through the neon palette. */
function documentColorMap(nodes: BrainNode[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const node of nodes) {
		if (map.has(node.documentId)) continue;
		const color = DOC_PALETTE[map.size % DOC_PALETTE.length] ?? "#22d3ee";
		map.set(node.documentId, color);
	}
	return map;
}

/** Escape text before it is placed into the tooltip's innerHTML. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** Parse `#rrggbb` into an [r, g, b] triplet (0–255). */
function parseHex(hex: string): [number, number, number] {
	const value = hex.replace("#", "");
	const at = (start: number): number =>
		Number.parseInt(value.slice(start, start + 2), 16) || 0;
	return [at(0), at(2), at(4)];
}

/** Linearly interpolate between two hex colours. `t` is clamped to [0, 1]. */
function lerpColor(from: string, to: string, t: number): string {
	const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
	const a = parseHex(from);
	const b = parseHex(to);
	const channel = (i: 0 | 1 | 2): string =>
		Math.round(a[i] + (b[i] - a[i]) * clamped)
			.toString(16)
			.padStart(2, "0");
	return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** At runtime force-graph replaces a link endpoint with the node object. */
function endpointId(endpoint: BrainLink["source"]): string {
	if (typeof endpoint === "object" && endpoint !== null) {
		return String((endpoint as { id: string }).id);
	}
	return String(endpoint);
}

/**
 * Collect the nodes and links directly adjacent to a node, for hover focus.
 */
function neighborsOf(
	node: GraphNode,
	links: GraphLink[],
): { nodes: Set<string>; links: Set<GraphLink> } {
	const nodeIds = new Set<string>([String(node.id)]);
	const linkSet = new Set<GraphLink>();
	const nodeId = String(node.id);
	for (const link of links) {
		const source = endpointId(link.source);
		const target = endpointId(link.target);
		if (source === nodeId || target === nodeId) {
			linkSet.add(link);
			nodeIds.add(source);
			nodeIds.add(target);
		}
	}
	return { nodes: nodeIds, links: linkSet };
}

export function BrainGraph({
	graph,
}: {
	graph: BrainGraphData;
}): React.JSX.Element {
	const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink>>(undefined);
	const containerRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });
	const [hovered, setHovered] = useState<GraphNode | null>(null);

	// Per-element animated highlight intensity (0 = resting, 1 = fully lit).
	// Eased every frame toward a target so hover transitions glide in/out.
	const nodeIntensity = useRef(new Map<string, number>());
	const linkIntensity = useRef(new Map<GraphLink, number>());
	const focusRef = useRef<ReturnType<typeof neighborsOf> | null>(null);
	const hoveredIdRef = useRef<string | null>(null);

	// react-force-graph mutates link.source/target into node objects, so clone.
	const data = useMemo(
		() => ({
			nodes: graph.nodes.map((node) => ({ ...node })),
			links: graph.links.map((link) => ({ ...link })),
		}),
		[graph],
	);

	const focus = useMemo(
		() => (hovered ? neighborsOf(hovered, data.links) : null),
		[hovered, data.links],
	);

	// Mirror hover state into refs so the per-frame animation loop can read the
	// current target without being recreated on every hover. `hoveredIdRef` is
	// kept sticky on unhover so the flared node's white eases back to base via its
	// own fading intensity instead of snapping in a single frame.
	focusRef.current = focus;
	if (hovered) hoveredIdRef.current = String(hovered.id);

	const docColors = useMemo(() => documentColorMap(data.nodes), [data.nodes]);

	// Track container size so the canvas fills available space responsively.
	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			setSize({
				width: entry.contentRect.width,
				height: entry.contentRect.height,
			});
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	// Bloom pass — recreated when the canvas resizes so its resolution matches.
	useEffect(() => {
		const fg = fgRef.current;
		if (!fg || size.width === 0) return;
		const bloom = new UnrealBloomPass(
			new THREE.Vector2(size.width, size.height),
			0.9, // strength — soft baseline so nodes aren't all blown out
			0.6, // radius
			0.35, // threshold — only the brighter (active) nodes flare
		);
		const composer = fg.postProcessingComposer();
		composer.addPass(bloom);
		return () => {
			composer.removePass(bloom);
			bloom.dispose();
		};
	}, [size.width, size.height]);

	// One-time layout setup: forces, controls, and initial framing. Kept out of
	// the resize effect so collapsing the sidebar never reheats/re-scatters the
	// graph — it runs once, after the instance is ready and the size is known.
	const layoutReady = useRef(false);
	useEffect(() => {
		const fg = fgRef.current;
		if (!fg || size.width === 0 || layoutReady.current) return;
		layoutReady.current = true;

		// Deterministic spacing so the layout always opens into a constellation
		// rather than occasionally settling into a tight ball. Defaults (charge
		// -30-ish, link distance 30) are too weak for a densely linked graph.
		const charge = fg.d3Force("charge") as
			| { strength: (n: number) => void; distanceMax: (n: number) => void }
			| undefined;
		if (charge) {
			charge.strength(-220); // stronger mutual repulsion → more spread
			charge.distanceMax(600); // cap range so distant clusters stay put
		}
		const linkForce = fg.d3Force("link") as
			| { distance: (fn: () => number) => void }
			| undefined;
		if (linkForce) {
			linkForce.distance(() => 55); // explicit rest length between linked nodes
		}
		// Collision force: nodes physically cannot overlap, which is the robust
		// guard against the layout packing into a tight cluster regardless of seed.
		fg.d3Force("collision", forceCollide(14));
		// Re-settle once with the new forces so spacing is consistent every load.
		fg.d3ReheatSimulation();

		// Faster, snappier zoom — the trackball default (1.2) feels sluggish.
		const controls = fg.controls() as { zoomSpeed?: number };
		controls.zoomSpeed = 3.2;
		// Frame the whole constellation once it has settled (matches the common
		// force-graph pattern of zoomToFit on load).
		const fitTimer = setTimeout(() => fg.zoomToFit(700, 60), 1200);
		return () => clearTimeout(fitTimer);
	}, [size.width]);

	// Animation loop: ease each node/link intensity toward its focus target and
	// repaint, so hover highlight and fade-out glide instead of snapping.
	useEffect(() => {
		const fg = fgRef.current;
		if (!fg || size.width === 0) return;
		let frame = 0;
		const EASE = 0.18; // per-frame approach rate (~120ms settle at 60fps)
		const tick = (): void => {
			const currentFocus = focusRef.current;
			const nodeMap = nodeIntensity.current;
			const linkMap = linkIntensity.current;
			let changed = false;

			for (const node of data.nodes) {
				const id = String(node.id);
				const target = !currentFocus ? 0 : currentFocus.nodes.has(id) ? 1 : -1; // negative target = dim below resting
				const prev = nodeMap.get(id) ?? 0;
				const next = prev + (target - prev) * EASE;
				if (Math.abs(next - prev) > 0.001) changed = true;
				nodeMap.set(id, next);
			}

			for (const link of data.links) {
				const target = currentFocus?.links.has(link) ? 1 : 0;
				const prev = linkMap.get(link) ?? 0;
				const next = prev + (target - prev) * EASE;
				if (Math.abs(next - prev) > 0.001) changed = true;
				linkMap.set(link, next);
			}

			if (changed) fg.refresh();
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [data, size.width]);

	const nodeColor = useCallback(
		(node: GraphNode): string => {
			const base = docColors.get(node.documentId) ?? "#22d3ee";
			const intensity = nodeIntensity.current.get(String(node.id)) ?? 0;
			if (intensity >= 0) {
				// 0 → resting colour, 1 → bright flare on the focused node.
				const isHovered = String(node.id) === hoveredIdRef.current;
				return lerpColor(base, isHovered ? NODE_HOT : base, intensity);
			}
			// Negative intensity fades toward the dim colour for unrelated nodes.
			return lerpColor(base, NODE_DIM, -intensity);
		},
		[docColors],
	);

	const linkColor = useCallback((link: GraphLink): string => {
		const resting = link.kind === "sequence" ? "#155e75" : "#0e7490";
		const intensity = linkIntensity.current.get(link) ?? 0;
		if (intensity <= 0.001) return focusRef.current ? LINK_DIM : resting;
		return lerpColor(
			focusRef.current ? LINK_DIM : resting,
			LINK_HOT,
			intensity,
		);
	}, []);

	const linkWidth = useCallback((link: GraphLink): number => {
		const intensity = linkIntensity.current.get(link) ?? 0;
		return 0.4 + intensity * 0.8;
	}, []);

	const particles = useCallback(
		(link: GraphLink): number =>
			(linkIntensity.current.get(link) ?? 0) > 0.5 ? 4 : 0,
		[],
	);

	return (
		<div ref={containerRef} className="relative size-full">
			<ForceGraph3D<GraphNode, GraphLink>
				ref={fgRef}
				width={size.width || undefined}
				height={size.height || undefined}
				graphData={data}
				backgroundColor="#05080d"
				nodeId="id"
				nodeLabel={(node) =>
					`<div style="max-width:260px"><strong>${escapeHtml(node.documentTitle)}</strong> · #${node.ordinal}<br/>${escapeHtml(node.preview)}</div>`
				}
				nodeColor={nodeColor}
				nodeVal={1.5}
				nodeRelSize={4}
				nodeOpacity={0.95}
				nodeResolution={16}
				linkColor={linkColor}
				linkWidth={linkWidth}
				linkOpacity={0.5}
				linkDirectionalParticles={particles}
				linkDirectionalParticleWidth={1.8}
				linkDirectionalParticleSpeed={0.006}
				linkDirectionalParticleColor={() => LINK_HOT}
				onNodeHover={(node) => setHovered(node)}
				onNodeClick={(node) => {
					const fg = fgRef.current;
					if (!fg || node.x == null || node.y == null || node.z == null) return;
					const distance = 120;
					const ratio = 1 + distance / Math.hypot(node.x, node.y, node.z || 1);
					fg.cameraPosition(
						{ x: node.x * ratio, y: node.y * ratio, z: (node.z || 1) * ratio },
						{ x: node.x, y: node.y, z: node.z },
						1200,
					);
				}}
				enableNodeDrag={false}
				showNavInfo={false}
			/>
		</div>
	);
}
