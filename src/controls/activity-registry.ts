import type { Procedure } from "../module-activity/generated/workflow.js";
import { digest } from "./canonical-json.js";

interface ProcedureBinding {
  readonly bindingId: string;
  readonly moduleCode: string;
  readonly procedureSha256: string;
  readonly revisionRule: Procedure["profile"];
  readonly sharedId: string;
  readonly sharedVersion: string;
  readonly sharedSha256: string;
  readonly local: "absent";
  readonly revisionOutput: "native-note-or-verified-reuse" | "not-required";
  readonly scope: "generated-control-evidence-only";
}

export const activityProcedureRegistry = [
  {
    bindingId: "retained-teaching-b7c02313d12d84eb",
    moduleCode: "CC0001",
    procedureSha256:
      "b7c02313d12d84eb98106ac08a027d97c3b42d0506e36f3c50b592e23e8d9d8f",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-f51e5b6a849698e9",
    moduleCode: "MH1100",
    procedureSha256:
      "f51e5b6a849698e987d355a17acd1c0d7f108e1ba70c0edb304c8544a58466bb",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-9607e8d9f95507c9",
    moduleCode: "MH1200",
    procedureSha256:
      "9607e8d9f95507c9595ef6a689fb6fc67f057583a756380594d0072a606b391f",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-a9ce79b445e9ddda",
    moduleCode: "MH1300",
    procedureSha256:
      "a9ce79b445e9ddda608cbb1a1bb642c51028ad486790ee0fcf1c247991e41eba",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-acbb6bfa23f3e388",
    moduleCode: "PH1104",
    procedureSha256:
      "acbb6bfa23f3e38861076620b6018b72430743871274b3d5da940f4591518233",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-0214ed5838795627",
    moduleCode: "PH1198",
    procedureSha256:
      "0214ed583879562741b6cffcdcab0b8354ce37b326ccae73d62b39fb8ed062d3",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-c7cb155a6a6b77ba",
    moduleCode: "PS0001",
    procedureSha256:
      "c7cb155a6a6b77ba9a7976cfee331e4476ec5df3164db0e8452515ced6fc1773",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-4b0c33a277d482d0",
    moduleCode: "CC0003",
    procedureSha256:
      "4b0c33a277d482d0d24594dd05acf60d9f6e349e87a62c2fd95ccde1e19002cb",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-ed780c5a74530194",
    moduleCode: "CC0015",
    procedureSha256:
      "ed780c5a745301946687236c9cc9cf13b7067d78cafcfeef50fa0697f8077888",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-f7234b941b6e26c7",
    moduleCode: "CL0101",
    procedureSha256:
      "f7234b941b6e26c7b7459310a39fc6ecf8f70bed92acb971240abdf74b4d4a1e",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-dce461f6afe476ff",
    moduleCode: "MH1101",
    procedureSha256:
      "dce461f6afe476fff8c07cb38f91cc0eb95a2c4766f9b8716966a8717cb7bee1",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-0c925aab4bc650f7",
    moduleCode: "MH1201",
    procedureSha256:
      "0c925aab4bc650f7ef6c53d1feacd5d2b502f61401e741b5c4efe52f937ead1c",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-c257c6609a8dc1e0",
    moduleCode: "MH2220",
    procedureSha256:
      "c257c6609a8dc1e0eccc8d43e995b63cfac36593181e3218993ff108eb335717",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-e76be7fe327087d7",
    moduleCode: "PH1106",
    procedureSha256:
      "e76be7fe327087d7b0f2ce5b83f3637b726be6987be6ece231bf51fb562be80a",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-aafea210b40b6156",
    moduleCode: "PH1107",
    procedureSha256:
      "aafea210b40b6156dd5a942e3183bf52ea6d7434d30888304e20c327c4825a90",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-7a782a2e7c912b24",
    moduleCode: "PS0002",
    procedureSha256:
      "7a782a2e7c912b249336a12ea1df22f8d94ee2b2fbf2db032d08b362816907f5",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-0e978669a40008f7",
    moduleCode: "CC0006",
    procedureSha256:
      "0e978669a40008f7c6e7f9bbf87f93462658397601221891039f15aeaa0bd210",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-9a4e411834d08663",
    moduleCode: "MH2100",
    procedureSha256:
      "9a4e411834d08663e20e502b6bef465a2d9f2bd6353b97f920a5fbe6c7e73e88",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-996cc61c9a433470",
    moduleCode: "MH2500",
    procedureSha256:
      "996cc61c9a4334700b04e364b586a48e9b1b99902142606529f10206e4d9e5a6",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-4642388804a1716a",
    moduleCode: "MH3210",
    procedureSha256:
      "4642388804a1716ab4472087810766331dc8d0d042fd9835286b221a4dee990a",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-9997b035ef02b7e2",
    moduleCode: "MH3220",
    procedureSha256:
      "9997b035ef02b7e27b94bad8e1a43a18c10ec3183e4bdda0c7e34396710155ce",
    revisionRule: "contiguous-block-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "retained-teaching-4b623aea7738941d",
    moduleCode: "ML0004",
    procedureSha256:
      "4b623aea7738941d48e3662c88909dc7a84fc3b574566d4668f64f08d48da259",
    revisionRule: "single-topic-revision",
    sharedId: "retained-teaching-preferences",
    sharedVersion: "registry-1",
    sharedSha256:
      "16ff374b02edb0878a85140abfb4fe716a95a0e08ea25967595f00e6a1d15bd9",
    local: "absent",
    revisionOutput: "native-note-or-verified-reuse",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "synthetic-retained-revision-1",
    moduleCode: "ABCD1234A",
    procedureSha256:
      "efac3f583add0914d4a1149e5868bc7e46cb8ffbce14b0876bc07af0aaee9a64",
    revisionRule: "single-topic-revision",
    sharedId: "synthetic-preferences",
    sharedVersion: "1",
    sharedSha256:
      "3af0dd0a837456da9e019a7ee2b61631404e0600535dc0bca815c56065418a9f",
    local: "absent",
    revisionOutput: "not-required",
    scope: "generated-control-evidence-only",
  },
  {
    bindingId: "synthetic-retained-block-revision-1",
    moduleCode: "ABCD1234A",
    procedureSha256:
      "5a89449895056d4f34a75474f33748a8ce3b4d930b434bfdd505118ccef8382c",
    revisionRule: "contiguous-block-revision",
    sharedId: "synthetic-preferences",
    sharedVersion: "1",
    sharedSha256:
      "3af0dd0a837456da9e019a7ee2b61631404e0600535dc0bca815c56065418a9f",
    local: "absent",
    revisionOutput: "not-required",
    scope: "generated-control-evidence-only",
  },
] satisfies readonly ProcedureBinding[];
export const activityRegistryDigest = digest(activityProcedureRegistry);
