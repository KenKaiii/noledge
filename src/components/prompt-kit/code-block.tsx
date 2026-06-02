"use client";

import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
// `shiki/bundle/web` is far lighter than the all-languages `shiki` entry and its
// `codeToHtml` shorthand reuses a singleton highlighter, lazy-loading only the
// langs/themes actually requested.
import { codeToHtml } from "shiki/bundle/web";
import { cn } from "@/lib/utils";

/**
 * Signals that the surrounding markdown is still streaming. While true, code
 * blocks render plain text instead of re-running Shiki on every token flush.
 */
export const CodeHighlightContext = createContext<{ streaming: boolean }>({
	streaming: false,
});

export type CodeBlockProps = {
	children?: React.ReactNode;
	className?: string;
} & React.HTMLProps<HTMLDivElement>;

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
	return (
		<div
			className={cn(
				"not-prose flex w-full flex-col overflow-clip border",
				"border-border bg-card text-card-foreground rounded-xl",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

export type CodeBlockCodeProps = {
	code: string;
	language?: string;
	themes?: { light: string; dark: string };
	className?: string;
} & React.HTMLProps<HTMLDivElement>;

function CodeBlockCode({
	code,
	language = "tsx",
	themes = { light: "github-light", dark: "github-dark" },
	className,
	...props
}: CodeBlockCodeProps) {
	const { streaming } = useContext(CodeHighlightContext);
	const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

	useEffect(() => {
		// Defer highlighting until the stream settles: highlighting a block that
		// mutates every flush is wasteful and causes flicker.
		if (streaming) return;

		if (!code) {
			setHighlightedHtml("<pre><code></code></pre>");
			return;
		}

		let cancelled = false;
		void codeToHtml(code, {
			lang: language,
			themes: { light: themes.light, dark: themes.dark },
			defaultColor: "light-dark()",
		}).then((html) => {
			if (!cancelled) setHighlightedHtml(html);
		});
		return () => {
			cancelled = true;
		};
	}, [code, language, themes.light, themes.dark, streaming]);

	const classNames = cn(
		"w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4",
		className,
	);

	// SSR fallback: render plain code if not hydrated yet
	return highlightedHtml ? (
		<div
			className={classNames}
			dangerouslySetInnerHTML={{ __html: highlightedHtml }}
			{...props}
		/>
	) : (
		<div className={classNames} {...props}>
			<pre>
				<code>{code}</code>
			</pre>
		</div>
	);
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>;

function CodeBlockGroup({
	children,
	className,
	...props
}: CodeBlockGroupProps) {
	return (
		<div
			className={cn("flex items-center justify-between", className)}
			{...props}
		>
			{children}
		</div>
	);
}

export { CodeBlock, CodeBlockCode, CodeBlockGroup };
