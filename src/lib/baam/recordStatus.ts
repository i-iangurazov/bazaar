import { baamText } from "./companion";

const statusCopy: Record<string, [string, string, string]> = {
  DRAFT: ["Черновик", "Draft", "Долбоор"],
  COMPLETED: ["Завершён", "Completed", "Аяктады"],
  CANCELED: ["Отменён", "Cancelled", "Жокко чыгарылды"],
  CANCELLED: ["Отменён", "Cancelled", "Жокко чыгарылды"],
  SUBMITTED: ["Отправлен", "Submitted", "Жөнөтүлдү"],
  APPROVED: ["Подтверждён", "Approved", "Бекитилди"],
  RECEIVED: ["Получен", "Received", "Кабыл алынды"],
  PARTIALLY_RECEIVED: ["Частично получен", "Partially received", "Жарым-жартылай кабыл алынды"],
  CONFIRMED: ["Подтверждён", "Confirmed", "Ырасталды"],
  FULFILLED: ["Выдан", "Fulfilled", "Берилди"],
  READY: ["Готов к выдаче", "Ready", "Берүүгө даяр"],
  NEW: ["Новый", "New", "Жаңы"],
  IN_PROGRESS: ["В работе", "In progress", "Аткарылууда"],
  APPLIED: ["Применена", "Applied", "Колдонулду"],
};

export const baamRecordStatus = (status: string, locale: string) =>
  statusCopy[status] ? baamText(locale, ...statusCopy[status]) : status;
