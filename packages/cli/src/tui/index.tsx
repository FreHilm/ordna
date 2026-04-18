import { render } from "ink";
import React from "react";
import { App } from "./App.js";

export async function runBoard(): Promise<void> {
	const { waitUntilExit } = render(<App />);
	await waitUntilExit();
}
