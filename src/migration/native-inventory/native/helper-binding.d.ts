type HelperBuild = {
  platform: string;
  sourceSha256: string;
  available: boolean;
  architecture?: string;
  executableSha256?: string;
  compiler?: string;
};
export const helperBinding: HelperBuild &
  (
    | { encoding?: undefined; sourceFiles?: undefined }
    | {
        encoding: "academic-os-native-inventory-helper/2";
        sourceFiles: readonly { path: string; sha256: string }[];
      }
  );
