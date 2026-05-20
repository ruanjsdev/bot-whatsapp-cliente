/// <reference types="vite/client" />

import { DesktopApi } from "../../shared/types";

declare global {
  interface Window {
    botApi: DesktopApi;
  }
}
