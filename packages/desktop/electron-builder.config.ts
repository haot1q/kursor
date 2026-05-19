import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { Configuration } from "electron-builder"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const nativeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "native")
const hasNative = fs.existsSync(nativeDir)

const getBase = (): Configuration => ({
  artifactName: "kursor-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: hasNative
    ? [
        {
          from: "native/",
          to: "native/",
          filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
        },
      ]
    : [],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: false,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: false,
  },
  protocols: {
    name: "kursor",
    schemes: ["kursor"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: "ai.kursor.desktop.dev",
        productName: "kursor Dev",
        rpm: { packageName: "kursor-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "ai.kursor.desktop.beta",
        productName: "kursor Beta",
        protocols: { name: "kursor Beta", schemes: ["kursor"] },
        rpm: { packageName: "kursor-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.kursor.desktop",
        productName: "kursor",
        protocols: { name: "kursor", schemes: ["kursor"] },
        rpm: { packageName: "kursor" },
      }
    }
  }
}

export default getConfig()
