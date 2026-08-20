import type { DashboardLocale, DashboardTab } from '../domain/contracts.js';

export interface DashboardCopy {
  readonly appName: string;
  readonly badge: string;
  readonly skipToContent: string;
  readonly greeting: string;
  readonly welcome: string;
  readonly loading: string;
  readonly refreshing: string;
  readonly retry: string;
  readonly unavailable: string;
  readonly completedTests: string;
  readonly averageScore: string;
  readonly answeredQuestions: string;
  readonly correctAnswers: string;
  readonly recentResults: string;
  readonly noRecentResults: string;
  readonly testsTitle: string;
  readonly testsBody: string;
  readonly totalQuestions: string;
  readonly ticket: string;
  readonly questionCount: string;
  readonly attempts: string;
  readonly bestScore: string;
  readonly available: string;
  readonly locked: string;
  readonly progressTitle: string;
  readonly progressBody: string;
  readonly accuracy: string;
  readonly generatedAt: string;
  readonly tabs: Readonly<Record<DashboardTab, string>>;
}

const uz: DashboardCopy = {
  appName: 'Onless Lite namoyishi',
  badge: 'LITE',
  skipToContent: 'Asosiy mazmunga o‘tish',
  greeting: 'Salom',
  welcome: 'O‘quv natijalaringizning qisqa va tushunarli ko‘rinishi.',
  loading: 'Namoyish ma’lumotlari tayyorlanmoqda…',
  refreshing: 'Ma’lumotlar yangilanmoqda…',
  retry: 'Qayta urinish',
  unavailable: 'Namoyish ma’lumotlarini ko‘rsatib bo‘lmadi.',
  completedTests: 'Yakunlangan testlar',
  averageScore: 'O‘rtacha natija',
  answeredQuestions: 'Ishlangan savollar',
  correctAnswers: 'To‘g‘ri javoblar',
  recentResults: 'Oxirgi natijalar',
  noRecentResults: 'Hali namoyish natijalari yo‘q.',
  testsTitle: 'Testlar',
  testsBody: 'Biletlar holati va jamlangan natijalar faqat ko‘rish uchun berilgan.',
  totalQuestions: 'Jami savollar',
  ticket: 'Bilet',
  questionCount: 'Savollar',
  attempts: 'Urinishlar',
  bestScore: 'Eng yaxshi natija',
  available: 'Mavjud',
  locked: 'Yopiq',
  progressTitle: 'Progress',
  progressBody: 'Javoblar aniqligi va umumiy bajarilgan ish.',
  accuracy: 'Aniqlik',
  generatedAt: 'Namoyish vaqti',
  tabs: { home: 'Bosh sahifa', tests: 'Testlar', progress: 'Progress' },
};

const ru: DashboardCopy = {
  appName: 'Демонстрация Onless Lite',
  badge: 'LITE',
  skipToContent: 'Перейти к основному содержанию',
  greeting: 'Здравствуйте',
  welcome: 'Краткое и понятное представление учебных результатов.',
  loading: 'Демонстрационные данные загружаются…',
  refreshing: 'Данные обновляются…',
  retry: 'Повторить',
  unavailable: 'Не удалось показать демонстрационные данные.',
  completedTests: 'Завершённые тесты',
  averageScore: 'Средний результат',
  answeredQuestions: 'Решённые вопросы',
  correctAnswers: 'Правильные ответы',
  recentResults: 'Последние результаты',
  noRecentResults: 'Демонстрационных результатов пока нет.',
  testsTitle: 'Тесты',
  testsBody: 'Состояние билетов и сводные результаты доступны только для просмотра.',
  totalQuestions: 'Всего вопросов',
  ticket: 'Билет',
  questionCount: 'Вопросы',
  attempts: 'Попытки',
  bestScore: 'Лучший результат',
  available: 'Доступен',
  locked: 'Закрыт',
  progressTitle: 'Прогресс',
  progressBody: 'Точность ответов и общий объём выполненной работы.',
  accuracy: 'Точность',
  generatedAt: 'Время демонстрации',
  tabs: { home: 'Главная', tests: 'Тесты', progress: 'Прогресс' },
};

export function getDashboardCopy(locale: DashboardLocale): DashboardCopy {
  return locale === 'ru-RU' ? ru : uz;
}
