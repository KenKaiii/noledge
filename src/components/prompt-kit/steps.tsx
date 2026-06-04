"use client";

import { CaretDown } from "@phosphor-icons/react";
import type * as React from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type StepsItemProps = React.ComponentProps<"div">;

export function StepsItem({
	children,
	className,
	...props
}: StepsItemProps): React.JSX.Element {
	return (
		<div className={cn("text-sm text-muted-foreground", className)} {...props}>
			{children}
		</div>
	);
}

export type StepsTriggerProps = React.ComponentProps<
	typeof CollapsibleTrigger
> & {
	leftIcon?: React.ReactNode;
	swapIconOnHover?: boolean;
};

export function StepsTrigger({
	children,
	className,
	leftIcon,
	swapIconOnHover = true,
	...props
}: StepsTriggerProps): React.JSX.Element {
	return (
		<CollapsibleTrigger
			className={cn(
				"group flex w-full cursor-pointer items-center justify-start gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
				className,
			)}
			{...props}
		>
			<div className="flex items-center gap-2">
				{leftIcon ? (
					<span className="relative inline-flex size-4 items-center justify-center">
						<span
							className={cn(
								"transition-opacity",
								swapIconOnHover && "group-hover:opacity-0",
							)}
						>
							{leftIcon}
						</span>
						{swapIconOnHover ? (
							<CaretDown className="absolute size-4 opacity-0 transition-opacity group-hover:opacity-100 group-data-[state=open]:rotate-180" />
						) : null}
					</span>
				) : null}
				<span>{children}</span>
			</div>
			{leftIcon ? null : (
				<CaretDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
			)}
		</CollapsibleTrigger>
	);
}

export type StepsContentProps = React.ComponentProps<
	typeof CollapsibleContent
> & {
	bar?: React.ReactNode;
};

export function StepsContent({
	children,
	className,
	bar,
	...props
}: StepsContentProps): React.JSX.Element {
	return (
		<CollapsibleContent
			className={cn(
				"overflow-hidden text-popover-foreground data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
				className,
			)}
			{...props}
		>
			<div className="mt-3 grid max-w-full min-w-0 grid-cols-[min-content_minmax(0,1fr)] items-start gap-x-3">
				<div className="min-w-0 self-stretch">{bar ?? <StepsBar />}</div>
				<div className="min-w-0 space-y-2">{children}</div>
			</div>
		</CollapsibleContent>
	);
}

export type StepsBarProps = React.HTMLAttributes<HTMLDivElement>;

export function StepsBar({
	className,
	...props
}: StepsBarProps): React.JSX.Element {
	return (
		<div
			className={cn("h-full w-[2px] bg-muted", className)}
			aria-hidden
			{...props}
		/>
	);
}

export type StepsProps = React.ComponentProps<typeof Collapsible>;

export function Steps({
	defaultOpen = true,
	className,
	...props
}: StepsProps): React.JSX.Element {
	return (
		<Collapsible
			className={cn(className)}
			defaultOpen={defaultOpen}
			{...props}
		/>
	);
}
