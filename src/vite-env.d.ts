/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIMLI_API_KEY: string
  readonly VITE_ELEVENLABS_API_KEY: string
  readonly VITE_COMPLETION_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
