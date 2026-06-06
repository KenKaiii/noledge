"use client";

import {
	ArrowsOutSimple,
	MagnifyingGlassMinus,
	MagnifyingGlassPlus,
} from "@phosphor-icons/react";
import { forceCollide } from "d3-force-3d";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, {
	type ForceGraphMethods,
	type NodeObject,
} from "react-force-graph-3d";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import { Button } from "@/components/ui/button";
import type {
	BrainGraph as BrainGraphData,
	BrainLink,
	BrainNode,
} from "@/lib/ai/brain/graph";

const BG_DARK = "#151718";
const BG_LIGHT = "#ffffff";

// Tracks the active theme by observing the `.dark` class the theme system
// toggles on <html>. Decoupled from useTheme(), whose state is per-instance and
// would not see changes made by other components (e.g. the settings dialog).
function useIsDark(): boolean {
	const [isDark, setIsDark] = useState(false);
	useEffect(() => {
		const root = document.documentElement;
		const sync = (): void => setIsDark(root.classList.contains("dark"));
		sync();
		const observer = new MutationObserver(sync);
		observer.observe(root, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => observer.disconnect();
	}, []);
	return isDark;
}

type GraphNode = NodeObject<BrainNode>;
type GraphLink = BrainLink;

/** Live simulation coordinates force-graph mutates onto each node object. */
type NodeCoords = { x?: number; y?: number; z?: number };

type ClusterLabel = {
	documentId: string;
	title: string;
	/** What is actually rendered — truncated at rest, longer when focused. */
	text: string;
	color: string;
	x: number;
	y: number;
	visible: boolean;
	/** The hovered cluster — shown in full and emphasized. */
	focused: boolean;
	/** De-emphasized because a different cluster is focused. */
	faded: boolean;
};

// Largest clusters that stay labelled even in the zoomed-out overview, so the
// map always has a few anchors to orient by.
const ANCHOR_COUNT = 6;
// Above this many nodes the graph is treated as "large": bloom and the
// per-frame glow easing are disabled (static colours) so heavy geometry rebuilds
// never run, and per-cluster centroid sampling is bounded.
const LARGE_NODE_THRESHOLD = 600;
// Cap how many node ids per cluster feed the centroid projection, so the label
// loop stays cheap on big documents.
const MAX_CENTROID_SAMPLES = 24;
// Approximate text-xs metrics used to estimate a label's screen box for the
// collision pass (avg glyph width + horizontal padding, line height).
const CHAR_PX = 6.2;
const LABEL_PAD_PX = 16;
const LABEL_H_PX = 22;

/** Shorten a title to a single readable chip, with an ellipsis when clipped. */
function truncateLabel(title: string, max: number): string {
	if (title.length <= max) return title;
	return `${title.slice(0, max - 1).trimEnd()}\u2026`;
}

/** Center-anchored axis-aligned box overlap test for label collision. */
function boxesOverlap(
	a: { x: number; y: number; w: number; h: number },
	b: { x: number; y: number; w: number; h: number },
): boolean {
	return (
		Math.abs(a.x - b.x) < (a.w + b.w) / 2 &&
		Math.abs(a.y - b.y) < (a.h + b.h) / 2
	);
}

// Highlight/dim anchors per theme. Dark mode flares toward near-white on a dark
// canvas; light mode flares toward near-black so nodes stay legible on white.
const NODE_HOT_DARK = "#f0fdff";
const NODE_HOT_LIGHT = "#0f172a";
const NODE_DIM_DARK = "#1e3a44";
const NODE_DIM_LIGHT = "#cbd5e1";
const LINK_HOT_DARK = "#67e8f9";
const LINK_HOT_LIGHT = "#0e7490";
const LINK_DIM_DARK = "#0c2a33";
const LINK_DIM_LIGHT = "#e2e8f0";

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
	const isDark = useIsDark();
	const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink>>(undefined);
	const containerRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });
	const [hovered, setHovered] = useState<GraphNode | null>(null);
	// A clicked cluster stays selected: its nodes flare while everything else
	// dims, until the background is clicked or another cluster is selected.
	const [selectedDoc, setSelectedDoc] = useState<string | null>(null);

	// Per-element animated highlight intensity (0 = resting, 1 = fully lit).
	// Eased every frame toward a target so hover transitions glide in/out.
	const nodeIntensity = useRef(new Map<string, number>());
	const linkIntensity = useRef(new Map<GraphLink, number>());
	const focusRef = useRef<ReturnType<typeof neighborsOf> | null>(null);
	const hoveredIdRef = useRef<string | null>(null);
	// Node ids that should flare to the bright "hot" colour: the hovered node, or
	// every node of the selected cluster.
	const hotIdsRef = useRef<Set<string>>(new Set());
	// Document of the hovered node, read by the label loop to focus that cluster's
	// label and fade the rest. Cleared on unhover (unlike hoveredIdRef).
	const hoveredDocRef = useRef<string | null>(null);
	// Camera distance right after the initial zoom-to-fit, used as the reference
	// for "overview" vs "zoomed in" so label gating adapts to the graph's scale.
	const baselineDistanceRef = useRef<number | null>(null);

	// react-force-graph mutates link.source/target into node objects, so clone.
	const data = useMemo(
		() => ({
			nodes: graph.nodes.map((node) => ({ ...node })),
			links: graph.links.map((link) => ({ ...link })),
		}),
		[graph],
	);

	// Large graphs cannot afford per-frame geometry rebuilds (bloom + glow easing)
	// or unbounded label sampling; switch to static colours and bounded work.
	const isLarge = data.nodes.length > LARGE_NODE_THRESHOLD;

	// onNodeHover fires on every pointer move over a node and intermittently
	// reports null between frames, which made the highlight flicker. Ignore events
	// that do not actually change the hovered node.
	const handleNodeHover = useCallback((node: GraphNode | null): void => {
		const nextId = node ? String(node.id) : null;
		setHovered((prev) => {
			const prevId = prev ? String(prev.id) : null;
			return nextId === prevId ? prev : node;
		});
	}, []);

	// The selected cluster as a focus set: every node of the document, plus the
	// links whose both endpoints live inside it (its internal structure).
	const selection = useMemo(() => {
		if (!selectedDoc) return null;
		const docByNode = new Map<string, string>(
			data.nodes.map((node) => [String(node.id), node.documentId]),
		);
		const nodes = new Set<string>();
		for (const node of data.nodes) {
			if (node.documentId === selectedDoc) nodes.add(String(node.id));
		}
		const links = new Set<GraphLink>();
		for (const link of data.links) {
			const source = endpointId(link.source);
			const target = endpointId(link.target);
			if (
				docByNode.get(source) === selectedDoc &&
				docByNode.get(target) === selectedDoc
			)
				links.add(link);
		}
		return { nodes, links };
	}, [selectedDoc, data.nodes, data.links]);

	const hoverFocus = useMemo(
		() => (hovered ? neighborsOf(hovered, data.links) : null),
		[hovered, data.links],
	);

	// Hover refines on top of a selection; otherwise the selection drives focus.
	const focus = hoverFocus ?? selection;

	// Mirror hover/selection state into refs so the per-frame animation loop can
	// read the current target without being recreated on every change.
	// `hoveredIdRef` is kept sticky on unhover so the flared node's white eases
	// back to base via its own fading intensity instead of snapping in a frame.
	focusRef.current = focus;
	if (hovered) hoveredIdRef.current = String(hovered.id);
	hoveredDocRef.current = hovered ? hovered.documentId : selectedDoc;
	// What flares hot: the single hovered node, or the whole selected cluster.
	hotIdsRef.current = hovered
		? new Set([String(hovered.id)])
		: (selection?.nodes ?? new Set());

	const docColors = useMemo(() => documentColorMap(data.nodes), [data.nodes]);

	// One cluster per source document: its title plus the node ids that compose it,
	// so a single label can be parked at the cluster's centroid.
	const clusters = useMemo(() => {
		const byDoc = new Map<
			string,
			{ documentId: string; title: string; nodeIds: string[] }
		>();
		for (const node of data.nodes) {
			const existing = byDoc.get(node.documentId);
			if (existing) {
				existing.nodeIds.push(String(node.id));
			} else {
				byDoc.set(node.documentId, {
					documentId: node.documentId,
					title: node.documentTitle,
					nodeIds: [String(node.id)],
				});
			}
		}
		// Largest clusters first so label placement gives them priority and the top
		// few can serve as always-on anchors.
		return [...byDoc.values()].sort(
			(a, b) => b.nodeIds.length - a.nodeIds.length,
		);
	}, [data.nodes]);

	// Document ids of the largest clusters, kept labelled even in the overview.
	const anchorIds = useMemo(
		() => new Set(clusters.slice(0, ANCHOR_COUNT).map((c) => c.documentId)),
		[clusters],
	);

	// Screen-space position + visibility for each cluster label, refreshed every
	// frame from the projected centroid of the cluster's nodes.
	const [labels, setLabels] = useState<ClusterLabel[]>([]);

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
		// Additive bloom only reads well on a dark canvas; on white it washes the
		// whole scene out, so it is disabled in light mode. It is also disabled for
		// large graphs, where the post-processing pass is too costly.
		if (!isDark || isLarge) {
			fg.refresh();
			return;
		}
		const bloom = new UnrealBloomPass(
			new THREE.Vector2(size.width, size.height),
			0.5, // strength — kept low so the background stays dark, not washed out
			0.6, // radius
			0.6, // threshold — only the brightest (active) nodes flare
		);
		const composer = fg.postProcessingComposer();
		composer.addPass(bloom);
		fg.refresh();
		return () => {
			composer.removePass(bloom);
			bloom.dispose();
		};
	}, [size.width, size.height, isDark, isLarge]);

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
		// force-graph pattern of zoomToFit on load), then capture the fitted camera
		// distance as the baseline for label zoom-gating.
		const fitTimer = setTimeout(() => fg.zoomToFit(700, 60), 1200);
		const baselineTimer = setTimeout(() => {
			const cam = fg.camera();
			baselineDistanceRef.current = Math.hypot(
				cam.position.x,
				cam.position.y,
				cam.position.z,
			);
		}, 2100);
		return () => {
			clearTimeout(fitTimer);
			clearTimeout(baselineTimer);
		};
	}, [size.width]);

	// Animation loop: ease each node/link intensity toward its focus target and
	// repaint, so hover highlight and fade-out glide instead of snapping. On large
	// graphs this is disabled entirely (static colours via nodeColor/linkColor) so
	// the per-frame fg.refresh() geometry rebuild never runs. On small graphs the
	// loop idles itself once there is no focus and every intensity has eased to ~0,
	// resuming on the next hover/selection.
	// `focus` is intentionally a dependency though the loop reads focusRef: a new
	// hover/selection must re-run this effect to wake the loop after it idled.
	// biome-ignore lint/correctness/useExhaustiveDependencies: focus re-arms the idled rAF loop
	useEffect(() => {
		const fg = fgRef.current;
		if (!fg || size.width === 0 || isLarge) return;
		let frame = 0;
		const EASE = 0.18; // per-frame approach rate (~120ms settle at 60fps)
		const tick = (): void => {
			const currentFocus = focusRef.current;
			const nodeMap = nodeIntensity.current;
			const linkMap = linkIntensity.current;
			let changed = false;
			let active = currentFocus != null; // any non-resting target keeps us awake

			for (const node of data.nodes) {
				const id = String(node.id);
				const target = !currentFocus ? 0 : currentFocus.nodes.has(id) ? 1 : -1; // negative target = dim below resting
				const prev = nodeMap.get(id) ?? 0;
				const next = prev + (target - prev) * EASE;
				if (Math.abs(next - prev) > 0.001) changed = true;
				if (Math.abs(next) > 0.001) active = true;
				nodeMap.set(id, next);
			}

			for (const link of data.links) {
				const target = currentFocus?.links.has(link) ? 1 : 0;
				const prev = linkMap.get(link) ?? 0;
				const next = prev + (target - prev) * EASE;
				if (Math.abs(next - prev) > 0.001) changed = true;
				if (Math.abs(next) > 0.001) active = true;
				linkMap.set(link, next);
			}

			if (changed) fg.refresh();
			// Idle once everything has settled to rest with no focus; the next
			// hover/selection re-runs this effect (focus is a dependency) and wakes it.
			if (!active) return;
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [data, size.width, isLarge, focus]);

	// Project each cluster centroid to screen space every frame so the labels
	// track the constellation as it settles, rotates, or zooms.
	useEffect(() => {
		const fg = fgRef.current;
		if (!fg || size.width === 0 || clusters.length === 0) return;
		// force-graph mutates live x/y/z onto these node objects at runtime, which
		// the cloned BrainNode type does not express; read them through a coord view.
		const nodeById = new Map<string, NodeCoords>(
			data.nodes.map((node) => [String(node.id), node as NodeCoords]),
		);
		let frame = 0;
		let prev: ClusterLabel[] = [];
		// Last camera transform + focus state; the projection only changes when one of
		// these does, so we skip the expensive graph2ScreenCoords pass otherwise.
		let lastSig = "";
		// Precompute a bounded sample of node ids per cluster so the centroid pass is
		// O(clusters · MAX_CENTROID_SAMPLES) rather than O(nodes), even at 100k.
		const sampled = clusters.map((cluster) => ({
			documentId: cluster.documentId,
			title: cluster.title,
			nodeIds:
				cluster.nodeIds.length <= MAX_CENTROID_SAMPLES
					? cluster.nodeIds
					: Array.from(
							{ length: MAX_CENTROID_SAMPLES },
							(_, i) =>
								cluster.nodeIds[
									Math.floor(
										(i * cluster.nodeIds.length) / MAX_CENTROID_SAMPLES,
									)
								] ??
								cluster.nodeIds[0] ??
								"",
						),
		}));
		// Skip the React update unless a label actually moved or toggled, so the
		// overlay stops re-rendering once the simulation settles.
		const changedEnough = (a: ClusterLabel[], b: ClusterLabel[]): boolean => {
			if (a.length !== b.length) return true;
			for (let i = 0; i < a.length; i += 1) {
				const x = a[i];
				const y = b[i];
				if (!x || !y) return true;
				if (
					x.documentId !== y.documentId ||
					x.visible !== y.visible ||
					x.focused !== y.focused ||
					x.faded !== y.faded ||
					x.text !== y.text
				)
					return true;
				if (Math.abs(x.x - y.x) > 0.5 || Math.abs(x.y - y.y) > 0.5) return true;
			}
			return false;
		};
		const tick = (): void => {
			// Overview vs zoomed-in: while far out (near the fitted distance) only
			// anchor + focused labels show; zooming in reveals the rest.
			const cam = fg.camera();
			// Skip the whole projection when nothing that affects label positions has
			// changed since last frame: the camera, the focused cluster, or — while the
			// simulation is still settling — a sampled node's live position.
			const probe = nodeById.get(sampled[0]?.nodeIds[0] ?? "");
			const sig = `${cam.position.x.toFixed(1)},${cam.position.y.toFixed(
				1,
			)},${cam.position.z.toFixed(1)}|${hoveredDocRef.current ?? ""}|${(
				probe?.x ?? 0
			).toFixed(1)},${(probe?.y ?? 0).toFixed(1)}`;
			if (sig === lastSig) {
				frame = requestAnimationFrame(tick);
				return;
			}
			lastSig = sig;
			const distance = Math.hypot(
				cam.position.x,
				cam.position.y,
				cam.position.z,
			);
			const baseline = baselineDistanceRef.current;
			const overview = baseline != null && distance > baseline * 0.85;
			const focusDoc = hoveredDocRef.current;

			// First project every cluster centroid to screen space, then place by
			// priority with collision culling so labels never stack.
			type Candidate = {
				documentId: string;
				title: string;
				x: number;
				y: number;
				visible: boolean;
				isAnchor: boolean;
				isFocused: boolean;
			};
			const candidates: Candidate[] = [];
			for (const cluster of sampled) {
				let sx = 0;
				let sy = 0;
				let count = 0;
				for (const id of cluster.nodeIds) {
					const node = nodeById.get(id);
					if (!node || node.x == null || node.y == null) continue;
					const screen = fg.graph2ScreenCoords(node.x, node.y, node.z ?? 0);
					sx += screen.x;
					sy += screen.y;
					count += 1;
				}
				if (count === 0) continue;
				const x = sx / count;
				const y = sy / count;
				candidates.push({
					documentId: cluster.documentId,
					title: cluster.title,
					x,
					y,
					visible: x >= 0 && y >= 0 && x <= size.width && y <= size.height,
					isAnchor: anchorIds.has(cluster.documentId),
					isFocused: focusDoc === cluster.documentId,
				});
			}

			// Focused label wins, then larger clusters (candidates already sorted by
			// size). Placing in this order lets greedy collision keep the important
			// labels and drop the ones that would overlap them.
			candidates.sort((a, b) => Number(b.isFocused) - Number(a.isFocused));

			const placed: { x: number; y: number; w: number; h: number }[] = [];
			const next: ClusterLabel[] = [];
			for (const cand of candidates) {
				if (!cand.visible) continue;
				// In the overview, only anchors and the focused cluster are labelled.
				if (overview && !cand.isAnchor && !cand.isFocused) continue;
				const text = cand.isFocused
					? truncateLabel(cand.title, 72)
					: truncateLabel(cand.title, 30);
				const box = {
					x: cand.x,
					y: cand.y,
					w: text.length * CHAR_PX + LABEL_PAD_PX,
					h: LABEL_H_PX,
				};
				// The focused label is never culled; everything else yields to it and
				// to already-placed higher-priority labels.
				if (!cand.isFocused && placed.some((p) => boxesOverlap(p, box)))
					continue;
				placed.push(box);
				next.push({
					documentId: cand.documentId,
					title: cand.title,
					text,
					color: docColors.get(cand.documentId) ?? "#22d3ee",
					x: cand.x,
					y: cand.y,
					visible: true,
					focused: cand.isFocused,
					faded: focusDoc != null && !cand.isFocused,
				});
			}
			if (changedEnough(next, prev)) {
				prev = next;
				setLabels(next);
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [clusters, anchorIds, data.nodes, docColors, size.width, size.height]);

	// Document super-nodes carry a chunk count in `size`; scale radius by its cube
	// root so volume tracks size without dwarfing small documents. Chunk nodes
	// (size 1) keep the original constant radius.
	const nodeVal = useCallback(
		(node: GraphNode): number => 1.5 * Math.cbrt(Math.max(1, node.size)),
		[],
	);

	const nodeColor = useCallback(
		(node: GraphNode): string => {
			const palette = docColors.get(node.documentId) ?? "#22d3ee";
			// On white the neon palette is too light; darken it for contrast.
			const base = isDark ? palette : lerpColor(palette, "#0f172a", 0.45);
			const hot = isDark ? NODE_HOT_DARK : NODE_HOT_LIGHT;
			const dim = isDark ? NODE_DIM_DARK : NODE_DIM_LIGHT;
			const intensity = nodeIntensity.current.get(String(node.id)) ?? 0;
			if (intensity >= 0) {
				// 0 → resting colour, 1 → bright flare on the hot (hovered/selected) nodes.
				const isHot = hotIdsRef.current.has(String(node.id));
				return lerpColor(base, isHot ? hot : base, intensity);
			}
			// Negative intensity fades toward the dim colour for unrelated nodes.
			return lerpColor(base, dim, -intensity);
		},
		[docColors, isDark],
	);

	const linkColor = useCallback(
		(link: GraphLink): string => {
			const restingDark = link.kind === "sequence" ? "#155e75" : "#0e7490";
			const restingLight = link.kind === "sequence" ? "#94a3b8" : "#64748b";
			const resting = isDark ? restingDark : restingLight;
			const hot = isDark ? LINK_HOT_DARK : LINK_HOT_LIGHT;
			const dim = isDark ? LINK_DIM_DARK : LINK_DIM_LIGHT;
			const intensity = linkIntensity.current.get(link) ?? 0;
			if (intensity <= 0.001) return focusRef.current ? dim : resting;
			return lerpColor(focusRef.current ? dim : resting, hot, intensity);
		},
		[isDark],
	);

	const linkWidth = useCallback((link: GraphLink): number => {
		const intensity = linkIntensity.current.get(link) ?? 0;
		return 0.4 + intensity * 0.8;
	}, []);

	const particles = useCallback(
		(link: GraphLink): number =>
			(linkIntensity.current.get(link) ?? 0) > 0.5 ? 4 : 0,
		[],
	);

	const zoomCamera = useCallback((factor: number): void => {
		const fg = fgRef.current;
		if (!fg) return;
		const cam = fg.camera();
		const controls = fg.controls() as { target?: THREE.Vector3 };
		const target = controls.target ?? new THREE.Vector3(0, 0, 0);
		fg.cameraPosition(
			{
				x: target.x + (cam.position.x - target.x) * factor,
				y: target.y + (cam.position.y - target.y) * factor,
				z: target.z + (cam.position.z - target.z) * factor,
			},
			{ x: target.x, y: target.y, z: target.z },
			350,
		);
	}, []);

	const resetView = useCallback((): void => {
		setSelectedDoc(null);
		fgRef.current?.zoomToFit(900, 80);
	}, []);

	// Clicking a cluster label selects it (dimming everything else) and flies the
	// camera to look directly at its centroid. Clicking the selected one clears it.
	// `zoomToFit` only rescales distance along the current view axis, so an
	// off-centre cluster stays off-centre; we instead recentre on the centroid.
	const focusCluster = useCallback(
		(documentId: string): void => {
			const fg = fgRef.current;
			const willDeselect = selectedDoc === documentId;
			setSelectedDoc(willDeselect ? null : documentId);
			if (!fg) return;
			if (willDeselect) {
				fg.zoomToFit(900, 80);
				return;
			}

			// Centroid + bounding radius of the cluster's settled node positions.
			const coords: NodeCoords[] = [];
			for (const node of data.nodes) {
				if (node.documentId !== documentId) continue;
				const c = node as NodeCoords;
				if (c.x != null && c.y != null) coords.push(c);
			}
			if (coords.length === 0) return;
			let cx = 0;
			let cy = 0;
			let cz = 0;
			for (const c of coords) {
				cx += c.x ?? 0;
				cy += c.y ?? 0;
				cz += c.z ?? 0;
			}
			cx /= coords.length;
			cy /= coords.length;
			cz /= coords.length;
			let radius = 0;
			for (const c of coords) {
				radius = Math.max(
					radius,
					Math.hypot((c.x ?? 0) - cx, (c.y ?? 0) - cy, (c.z ?? 0) - cz),
				);
			}

			// Keep the current view direction but pull the camera to a distance that
			// frames the cluster, then look straight at its centroid.
			const cam = fg.camera();
			let dx = cam.position.x - cx;
			let dy = cam.position.y - cy;
			let dz = cam.position.z - cz;
			const len = Math.hypot(dx, dy, dz) || 1;
			dx /= len;
			dy /= len;
			dz /= len;
			const distance = Math.max(radius * 2.6, 140);
			fg.cameraPosition(
				{
					x: cx + dx * distance,
					y: cy + dy * distance,
					z: cz + dz * distance,
				},
				{ x: cx, y: cy, z: cz },
				900,
			);
		},
		[selectedDoc, data.nodes],
	);

	return (
		<div ref={containerRef} className="relative size-full">
			<ForceGraph3D<GraphNode, GraphLink>
				ref={fgRef}
				width={size.width || undefined}
				height={size.height || undefined}
				graphData={data}
				backgroundColor={isDark ? BG_DARK : BG_LIGHT}
				nodeId="id"
				nodeLabel={(node) =>
					`<div style="max-width:260px"><strong>${escapeHtml(node.documentTitle)}</strong> · #${node.ordinal}<br/>${escapeHtml(node.preview)}</div>`
				}
				nodeColor={nodeColor}
				nodeVal={nodeVal}
				nodeRelSize={4}
				nodeOpacity={0.95}
				nodeResolution={isLarge ? 8 : 16}
				linkColor={linkColor}
				linkWidth={linkWidth}
				linkOpacity={0.5}
				linkDirectionalParticles={particles}
				linkDirectionalParticleWidth={1.8}
				linkDirectionalParticleSpeed={0.006}
				linkDirectionalParticleColor={() =>
					isDark ? LINK_HOT_DARK : LINK_HOT_LIGHT
				}
				onBackgroundClick={() => setSelectedDoc(null)}
				onNodeHover={handleNodeHover}
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
			<div className="absolute top-6 right-6 z-30 flex items-center gap-1 rounded-full border bg-background/85 p-1 shadow-sm backdrop-blur">
				<Button
					variant="ghost"
					size="icon"
					type="button"
					className="size-8"
					aria-label="Zoom in"
					title="Zoom in"
					onClick={() => zoomCamera(0.68)}
				>
					<MagnifyingGlassPlus className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					type="button"
					className="size-8"
					aria-label="Zoom out"
					title="Zoom out"
					onClick={() => zoomCamera(1.45)}
				>
					<MagnifyingGlassMinus className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					type="button"
					className="size-8"
					aria-label="Reset camera"
					title="Reset camera"
					onClick={resetView}
				>
					<ArrowsOutSimple className="size-4" />
				</Button>
			</div>
			{labels.map((label) => (
				<button
					type="button"
					key={label.documentId}
					onClick={() => focusCluster(label.documentId)}
					title={label.title}
					className="absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-pointer whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium transition-opacity duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
					style={{
						left: label.x,
						top: label.y,
						opacity: label.faded ? 0.3 : 1,
						zIndex: label.focused ? 20 : 10,
						color: isDark
							? label.color
							: lerpColor(label.color, "#0f172a", 0.5),
						backgroundColor: isDark
							? label.focused
								? "rgba(21, 23, 24, 0.92)"
								: "rgba(21, 23, 24, 0.6)"
							: label.focused
								? "rgba(255, 255, 255, 0.95)"
								: "rgba(255, 255, 255, 0.7)",
						boxShadow: label.focused
							? "0 1px 8px rgba(0, 0, 0, 0.35)"
							: undefined,
					}}
				>
					{label.text}
				</button>
			))}
		</div>
	);
}
