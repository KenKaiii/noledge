/**
 * Minimal typings for the slice of `d3-force-3d` we use. The package ships no
 * declarations and there is no `@types/d3-force-3d`. We only need `forceCollide`
 * for the brain graph's collision force, so type just that rather than pull in a
 * loose `any` module declaration.
 */
declare module "d3-force-3d" {
	interface CollideForce<NodeDatum> {
		(alpha: number): void;
		radius(): (node: NodeDatum, i: number, nodes: NodeDatum[]) => number;
		radius(
			radius:
				| number
				| ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number),
		): this;
		strength(): number;
		strength(strength: number): this;
		iterations(): number;
		iterations(iterations: number): this;
	}

	export function forceCollide<NodeDatum = unknown>(
		radius?:
			| number
			| ((node: NodeDatum, i: number, nodes: NodeDatum[]) => number),
	): CollideForce<NodeDatum>;
}
