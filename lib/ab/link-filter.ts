/**
 * Tracked links that belong to an A/B test variant are not buttons of the
 * campaign itself. Use this filter wherever the campaign's own links are read
 * (the editor, the worker, duplication, link syncing), so a test never adds a
 * button or overwrites a link by accident.
 */
export const NOT_AB_VARIANT_LINK = { abTestAsA: null, abTestAsB: null } as const;

const AB_LINK_SELECT = { slug: true, label: true, destinationUrl: true } as const;

/** The campaign's running A/B test, if any, with the link of each variant. Use as `abTests:` in an include. */
export const RUNNING_AB_TEST = {
  where: { status: "RUNNING" },
  take: 1,
  include: {
    aTrackedLink: { select: AB_LINK_SELECT },
    bTrackedLink: { select: AB_LINK_SELECT },
  },
} as const;
