export type TarballCheck = Readonly<{
  hasReadme: boolean;
  hasLicense: boolean;
  hasTestArtifacts: boolean;
}>;

export function inspectTarballListing(listing: string): TarballCheck {
  const files = listing.trim().split(/\r?\n/).filter(Boolean);
  const hasReadme = files.some((file) => /package\/README\.md$/i.test(file));
  const hasLicense = files.some((file) => /package\/LICENSE$/i.test(file));
  const hasTestArtifacts = files.some((file) => /\.test\.(d\.ts|js|js\.map|ts|tsx)$/.test(file));
  return { hasReadme, hasLicense, hasTestArtifacts };
}
