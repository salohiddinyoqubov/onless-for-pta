export interface SearchParamReader {
  get(name: string): string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function readAliasedSearchParam(
  searchParams: SearchParamReader,
  canonical: string,
  ...legacy: readonly string[]
): string | undefined {
  const canonicalValue = searchParams.get(canonical);
  if (canonicalValue !== null) {
    return canonicalValue || undefined;
  }

  for (const key of legacy) {
    const legacyValue = searchParams.get(key);
    if (legacyValue !== null) {
      return legacyValue || undefined;
    }
  }

  return undefined;
}

/** Absence is valid; only a present malformed retry identifier is rejected. */
export function hasInvalidRetrySessionId(
  searchParams: SearchParamReader,
): boolean {
  const value = readAliasedSearchParam(
    searchParams,
    'retry_session_id',
    'retrySessionId',
  );
  return value !== undefined && !isValidUuid(value);
}

/**
 * Creates stable route state with canonical parameters taking precedence over
 * compatibility aliases. JSON encoding prevents delimiter collisions.
 */
export function buildNonBattleExamRouteIdentity(
  searchParams: SearchParamReader,
): string {
  return JSON.stringify({
    mode: searchParams.get('mode') ?? 'exam',
    launchType: searchParams.get('launch_type') ?? '',
    intent: searchParams.get('intent') ?? '',
    entrySurface: searchParams.get('entry_surface') ?? '',
    ticketNumber:
      readAliasedSearchParam(searchParams, 'ticket_number', 'ticket') ?? '',
    categoryIds:
      readAliasedSearchParam(searchParams, 'category_ids', 'category') ?? '',
    existingSessionId:
      readAliasedSearchParam(searchParams, 'session_id', 'session') ?? '',
    dashboardSessionId: searchParams.get('sessionId') ?? '',
    retrySessionId:
      readAliasedSearchParam(
        searchParams,
        'retry_session_id',
        'retrySessionId',
      ) ?? '',
    examId: readAliasedSearchParam(searchParams, 'exam_id', 'examId') ?? '',
    questionCount: searchParams.get('question_count') ?? '',
    ticketRangeStart: searchParams.get('ticket_range_start') ?? '',
    ticketRangeEnd: searchParams.get('ticket_range_end') ?? '',
    trafficSignIds: searchParams.get('traffic_sign_ids') ?? '',
    hasImage: searchParams.get('has_image') ?? '',
    startQuestionId: searchParams.get('start_question') ?? '',
    skipInterval: searchParams.get('skip_interval') ?? '',
  });
}
