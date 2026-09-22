import * as ics from "ics";

export interface LabRecord {
  address: string;
  choose_date: string;
  contain: number;
  content: any;
  counts: number;
  course_id: number;
  course_lab_final_score: any;
  course_name: string;
  course_student_lab_id: number;
  dates: string;
  final_score: any;
  gmt_create: number;
  gmt_modified: any;
  id: number;
  is_must: number;
  lab_final_score: any;
  lab_ids: string;
  lab_name: string;
  major: string;
  open_week: string;
  phone: string;
  select_week: string;
  student_gender: string;
  student_name: string;
  student_uid: string;
  teacher_id: string;
  teacher_name: string;
  term_id: number;
  time: number;
  times: string;
  total_score: any;
  week: number;
}

type DateParts = [number, number, number];
type DateTimeParts = [number, number, number, number, number];

const CHINA_STANDARD_TIME_OFFSET_HOURS = 8;

interface IcsEventOptions {
  termName?: string;
  weekText?: string;
}

const parseDate = (value: string): DateParts => {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`实验日期格式无效：${value}`);
  }

  const parts = match.slice(1).map(Number) as DateParts;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`实验日期无效：${value}`);
  }

  return parts;
};

const parseDates = (value: string): DateParts[] => {
  if (typeof value !== "string") {
    throw new Error("实验日期为空");
  }

  const values = value
    .split(",")
    .map((date) => date.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error("实验日期为空");
  }

  return values.map(parseDate);
};

const parseTime = (value: string): [number, number] => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`实验开始时间格式无效：${value}`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`实验开始时间无效：${value}`);
  }

  return [hour, minute];
};

const parseWeeks = (value: string): number[] => {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((week) => Number(week.trim()))
    .filter((week) => Number.isInteger(week) && week > 0);
};

const formatWeeks = (weeks: number[]): string => {
  const uniqueWeeks = [...new Set(weeks)].sort((a, b) => a - b);
  if (uniqueWeeks.length === 0) {
    return "周次未知";
  }

  if (uniqueWeeks.length === 1) {
    return `第${uniqueWeeks[0]}周`;
  }

  const isContinuous = uniqueWeeks.every(
    (week, index) => index === 0 || week === uniqueWeeks[index - 1] + 1
  );
  return isContinuous
    ? `第${uniqueWeeks[0]}-${uniqueWeeks[uniqueWeeks.length - 1]}周`
    : `第${uniqueWeeks.join("、")}周`;
};

const formatTermName = (termName?: string): string => {
  const normalized = termName?.trim();
  if (!normalized) {
    return "学期";
  }

  const academicYearMatch = /学年(.+?)学期/.exec(normalized);
  if (academicYearMatch?.[1]) {
    return academicYearMatch[1].trim();
  }

  const semesterMatch = /(.+?)学期$/.exec(normalized);
  return semesterMatch?.[1]?.trim() || normalized;
};

const formatPeriods = (value: string): string => {
  const hour = Number(/^\s*(\d{1,2}):/.exec(value || "")?.[1]);
  return Number.isFinite(hour) && hour < 12 ? "第3-5节" : "第6-8节";
};

const toUtcDateTime = (
  date: DateParts,
  time: [number, number]
): DateTimeParts => {
  const [year, month, day] = date;
  const [hour, minute] = time;
  const utcDate = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      hour - CHINA_STANDARD_TIME_OFFSET_HOURS,
      minute
    )
  );

  return [
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth() + 1,
    utcDate.getUTCDate(),
    utcDate.getUTCHours(),
    utcDate.getUTCMinutes(),
  ];
};

export const toIcsEvent = (
  event: LabRecord,
  date: DateParts = parseDates(event.dates)[0],
  options: IcsEventOptions = {}
): ics.EventAttributes => {
  const time = parseTime(event.times);
  const weekText = options.weekText || formatWeeks(parseWeeks(event.select_week));

  return {
    title: event.lab_name,
    description: [
      `教师: ${event.teacher_name}`,
      `${formatTermName(options.termName)}{${weekText}|1节/周} ${formatPeriods(
        event.times
      )}`,
    ].join("\n"),
    start: toUtcDateTime(date, time),
    startInputType: "utc",
    startOutputType: "utc",
    duration: { hours: 2, minutes: 25 },
    location: event.address,
    status: "CONFIRMED",
    busyStatus: "BUSY",
  };
};

export const toIcsEvents = (
  event: LabRecord,
  options: Pick<IcsEventOptions, "termName"> = {}
): ics.EventAttributes[] => {
  const dates = parseDates(event.dates);
  const weeks = parseWeeks(event.select_week);

  return dates.map((date, index) =>
    toIcsEvent(event, date, {
      termName: options.termName,
      weekText: formatWeeks(weeks[index] ? [weeks[index]] : weeks),
    })
  );
};
