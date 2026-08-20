export type ExamContentLocale = 'uz' | 'ru' | 'kaa' | 'uz-Cyrl';

export type ReviewMode =
  | 'exam'
  | 'training'
  | 'category'
  | 'daily'
  | 'incorrect'
  | 'saved'
  | 'demo'
  | 'grand_mock'
  | 'checkpoint'
  | 'insight'
  | 'sign'
  | 'telegram_quiz'
  | 'extension';

export type ReviewStatus = 'COMPLETED' | 'FAILED' | 'EXPIRED';
export type ReviewKind = 'question_review' | 'summary_only';

export interface ReviewAnswerSnapshot {
  readonly answer_id: string;
  readonly display_order: number;
  readonly text: string;
  readonly text_locale: ExamContentLocale;
  readonly is_selected: boolean;
  readonly is_correct: boolean;
}

export interface ReviewQuestionSnapshot {
  readonly question_id: string;
  readonly position: number;
  readonly text: string;
  readonly text_locale: ExamContentLocale;
  readonly image_key: string | null;
  readonly image_url: string | null;
  readonly video_key: string | null;
  readonly video_url: string | null;
  readonly ticket_id: string | null;
  readonly ticket_position: number | null;
  readonly ticket_number: number | null;
  readonly answers: readonly ReviewAnswerSnapshot[];
  readonly correct_answer_id: string;
  readonly selected_answer_id: string | null;
  readonly is_correct: boolean | null;
  readonly is_unanswered: boolean;
  readonly time_spent_seconds: number | null;
  readonly explanation_available: boolean;
}

export interface ReviewSnapshot {
  readonly session_id: string;
  readonly revision: number;
  readonly status: ReviewStatus;
  readonly mode: ReviewMode;
  readonly locale: ExamContentLocale;
  readonly review_kind: ReviewKind;
  readonly exam_id: string | null;
  readonly ticket_id: string | null;
  readonly ticket_number: number | null;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly time_taken_seconds: number | null;
  readonly total_questions: number;
  readonly total_answered: number;
  readonly correct_count: number;
  readonly incorrect_count: number;
  readonly unanswered_count: number;
  readonly score_percentage: number;
  readonly has_passed: boolean;
  readonly questions: readonly ReviewQuestionSnapshot[];
}

export interface ReviewSnapshotExpectation {
  readonly sessionId: string;
  readonly locale: ExamContentLocale;
}

export type ReviewHeaderMode =
  | 'training'
  | 'exam'
  | 'category'
  | 'demo'
  | 'grand_mock'
  | 'insight';

export interface ReviewHeaderPresentation {
  readonly mode: ReviewHeaderMode;
  readonly labelMode: ReviewMode | null;
}

export interface QuestionOption {
  readonly id: string;
  readonly text: string;
}

export interface ReviewPageSessionViewModel {
  readonly id: string;
  readonly revision: number;
  readonly status: ReviewStatus;
  readonly mode: ReviewMode;
  readonly examId: string | null;
  readonly ticketId: string | null;
  readonly ticketNumber: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly timeTakenSeconds: number | null;
}

export interface ReviewPageSummaryViewModel {
  readonly totalQuestions: number;
  readonly totalAnswered: number;
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly unansweredCount: number;
  readonly scorePercentage: number;
  readonly hasPassed: boolean;
}

export interface ReviewPageQuestionViewModel {
  readonly id: string;
  readonly position: number;
  readonly text: string;
  readonly media: {
    readonly imagePath?: string;
    readonly videoPath?: string;
  };
  readonly ticketId: string | null;
  readonly ticketPosition: number | null;
  readonly ticketNumber: number | null;
  readonly options: readonly QuestionOption[];
  readonly correctOptionId: string;
  readonly correctOptionText: string;
  readonly selectedOptionId?: string;
  readonly selectedOptionText?: string;
  readonly isCorrect: boolean | null;
  readonly isUnanswered: boolean;
  readonly timeSpentSeconds: number | null;
  readonly explanationAvailable: boolean;
}

export interface ReviewPageViewModel {
  readonly loadedKey: string;
  readonly locale: ExamContentLocale;
  readonly reviewKind: ReviewKind;
  readonly session: ReviewPageSessionViewModel;
  readonly summary: ReviewPageSummaryViewModel;
  readonly questions: readonly ReviewPageQuestionViewModel[];
}
