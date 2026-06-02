"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ModelOption = {
	id: string;
	label: string;
	provider: string;
};

type ModelPickerProps = {
	value: string | null;
	onChange: (id: string) => void;
};

export function ModelPicker({
	value,
	onChange,
}: ModelPickerProps): React.JSX.Element | null {
	const [models, setModels] = useState<ModelOption[]>([]);
	const valueRef = useRef(value);
	valueRef.current = value;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	useEffect(() => {
		let active = true;
		void fetch("/api/models")
			.then((res) => res.json())
			.then(
				(data: { models: ModelOption[]; defaultModelId: string | null }) => {
					if (!active) return;
					setModels(data.models);
					if (!valueRef.current && data.defaultModelId) {
						onChangeRef.current(data.defaultModelId);
					}
				},
			)
			.catch(() => {
				/* leave picker hidden on failure */
			});
		return () => {
			active = false;
		};
	}, []);

	if (models.length === 0) return null;

	const current = models.find((model) => model.id === value);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" type="button" className="gap-1.5">
					<span className="max-w-32 truncate">{current?.label ?? "Model"}</span>
					<ChevronDown className="size-3.5 opacity-60" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="border-0">
				<DropdownMenuLabel>Model</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={value ?? undefined}
					onValueChange={onChange}
				>
					{models.map((model) => (
						<DropdownMenuRadioItem
							key={model.id}
							value={model.id}
							className="pl-2 [&>span:first-child]:hidden"
						>
							{model.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
