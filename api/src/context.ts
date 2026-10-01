import type { JWTVerifyGetKey } from 'jose';
import type { Repository } from './db/repository.js';
import type { Env } from './env.js';
import { GraphDirectory, MockDirectory, type Directory } from './services/directory.js';
import { Renderer } from './services/renderer.js';
import { UserResolver } from './services/resolver.js';
import { SecretBox } from './services/secrets.js';
import { SettingsService } from './services/settings.js';
import { Fonts } from './services/fonts.js';
import { ImageSignatures } from './services/imagesig.js';
import path from 'node:path';

export class AppContext {
  readonly secrets: SecretBox;
  readonly settings: SettingsService;
  readonly resolver: UserResolver;
  readonly renderer: Renderer;
  readonly fonts: Fonts;
  readonly images: ImageSignatures;
  readonly sessionKey: Buffer;
  /** One-time token printed to the logs; required to create the first admin. Null once an admin exists. */
  setupToken: string | null = null;
  private directoryInstance: Directory | null = null;

  constructor(
    readonly env: Env,
    readonly repo: Repository,
    /** Test hook: local JWKS instead of the tenant's. */
    readonly jwks?: JWTVerifyGetKey,
    /** Test hook: inject a directory. */
    directoryOverride?: Directory,
  ) {
    this.secrets = new SecretBox(env.dataDir, env.appSecret);
    this.settings = new SettingsService(repo, env, this.secrets);
    this.fonts = new Fonts(path.join(env.assetsDir, 'fonts'), path.join(env.dataDir, 'fonts'));
    this.images = new ImageSignatures(repo, this.fonts, path.join(env.dataDir, 'sig-img'));
    this.renderer = new Renderer(repo, this.images);
    this.resolver = new UserResolver(repo, () => this.directory(), () => this.settings.get());
    this.sessionKey = this.secrets.derive('session-id');
    this.directoryInstance = directoryOverride ?? null;
  }

  directory(): Directory {
    if (!this.directoryInstance) this.directoryInstance = this.buildDirectory();
    return this.directoryInstance;
  }

  buildDirectory(settingsOverride?: Partial<ReturnType<SettingsService['get']>>, credsOverride?: ReturnType<SettingsService['getCredentials']>): Directory {
    const s = { ...this.settings.get(), ...settingsOverride };
    if (s.directoryMode === 'mock' || this.env.mockGraph) return new MockDirectory(this.env.fixturesPath);
    const creds = credsOverride ?? this.settings.getCredentials();
    return new GraphDirectory({ tenantId: s.tenantId, clientId: s.clientId, ...creds });
  }

  /** Call after directory settings change. */
  resetDirectory() {
    this.directoryInstance = null;
    this.resolver.clearCache();
  }
}
