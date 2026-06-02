import { Suspense } from "react";

import { Chat } from "@/components/chat/chat";

export default function Home(): React.JSX.Element {
	return (
		<Suspense fallback={null}>
			<Chat />
		</Suspense>
	);
}
