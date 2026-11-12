// Fonts are bundled (the page's CSP only allows its own origin): Jost for the UI, IBM Plex Mono for figures and code.
import "@fontsource-variable/jost/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.body });
