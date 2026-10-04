export interface FeatureFlags {
  tinix_inbox_enabled: boolean;
  tinix_inbox_ai_enabled: boolean;
  tinix_inbox_meta_enabled: boolean;
  tinix_inbox_zalo_enabled: boolean;
  tinix_inbox_tiktok_shop_enabled: boolean;
  tinix_inbox_shopee_enabled: boolean;
  tinix_inbox_native_ui_enabled: boolean;
  tinix_inbox_n8n_tools_enabled: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  tinix_inbox_enabled: true,
  tinix_inbox_ai_enabled: true,
  tinix_inbox_meta_enabled: true,
  tinix_inbox_zalo_enabled: false,
  tinix_inbox_tiktok_shop_enabled: false,
  tinix_inbox_shopee_enabled: false,
  tinix_inbox_native_ui_enabled: true,
  tinix_inbox_n8n_tools_enabled: false,
};

export class FeatureFlagManager {
  private static instance: FeatureFlagManager;
  private flags: FeatureFlags;

  private constructor() {
    this.flags = { ...DEFAULT_FEATURE_FLAGS };
    for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as Array<keyof FeatureFlags>) {
      const envVal = process.env[key.toUpperCase()];
      if (envVal !== undefined) {
        this.flags[key] = envVal === 'true' || envVal === '1';
      }
    }
  }

  public static getInstance(): FeatureFlagManager {
    if (!FeatureFlagManager.instance) {
      FeatureFlagManager.instance = new FeatureFlagManager();
    }
    return FeatureFlagManager.instance;
  }

  public isEnabled(flag: keyof FeatureFlags): boolean {
    return !!this.flags[flag];
  }

  public setFlag(flag: keyof FeatureFlags, enabled: boolean): void {
    this.flags[flag] = enabled;
  }

  public getAll(): FeatureFlags {
    return { ...this.flags };
  }
}

export function channelEnabled(provider: string): boolean {
  const flags = FeatureFlagManager.getInstance().getAll();
  const key = `tinix_inbox_${provider}_enabled`;
  return flags.tinix_inbox_enabled && (!(key in flags) || flags[key as keyof FeatureFlags]);
}
