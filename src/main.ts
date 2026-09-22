import inquirer from "inquirer";
import * as ics from "ics";
import * as fs from "fs";

import { ApiResponse, GET, login } from "./networking";
import { LabRecord, toIcsEvents } from "./toIcsEvent";

interface Term {
  id: number;
  name: string;
  currentTerm?: number | string;
}

interface Course {
  id: number;
  courseName: string;
}

interface ContentPage<T> {
  content?: T[];
}

interface Credentials {
  username: string;
  password: string;
}

const outputFilename = "zjuphylab.ics";

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || error.name;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const details = error as {
      message?: unknown;
      errors?: unknown;
      path?: unknown;
    };
    const parts: string[] = [];

    if (typeof details.message === "string" && details.message) {
      parts.push(details.message);
    }
    if (Array.isArray(details.errors) && details.errors.length > 0) {
      parts.push(details.errors.map(String).join("；"));
    }
    if (details.path !== undefined) {
      parts.push(`字段路径：${String(details.path)}`);
    }
    if (parts.length > 0) {
      return parts.join("；");
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // Fall through to the generic representation below.
    }
  }

  return String(error);
};

const runStage = async <T>(
  stage: string,
  task: () => Promise<T>
): Promise<T> => {
  try {
    return await task();
  } catch (error) {
    throw new Error(`${stage}：${formatError(error)}`);
  }
};

const loadDotEnv = (): void => {
  if (!fs.existsSync(".env")) {
    return;
  }

  const content = fs.readFileSync(".env", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    const value = match[2];
    process.env[match[1]] =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
        ? value.slice(1, -1)
        : value;
  }
};

const getCredentials = async (): Promise<Credentials> => {
  loadDotEnv();

  if (process.env.USERNAME && process.env.PASSWORD) {
    return {
      username: process.env.USERNAME.trim(),
      password: process.env.PASSWORD,
    };
  }

  return inquirer.prompt<Credentials>([
    {
      type: "input",
      name: "username",
      message: "Enter your username",
    },
    {
      type: "password",
      name: "password",
      message: "Enter your password",
    },
  ]);
};

const unwrap = <T>(response: ApiResponse<T>, endpoint: string): T => {
  if (response.code !== 200) {
    throw new Error(
      `${endpoint} 请求失败：${response.message ?? `Code=${response.code}`}`
    );
  }

  return response.data;
};

const validateCalendarEvents = (events: ics.EventAttributes[]): void => {
  const errors: string[] = [];

  events.forEach((event, index) => {
    const label = event.title ? `事件 ${index + 1}“${event.title}”` : `事件 ${index + 1}`;
    const start = event.start;

    if (!Array.isArray(start) || start.length < 5) {
      errors.push(`${label}的 start 不是完整的日期时间数组`);
    } else {
      const [year, month, day, hour, minute] = start;
      if (![year, month, day, hour, minute].every(Number.isInteger)) {
        errors.push(`${label}的 start 含有非整数值：${JSON.stringify(start)}`);
      } else if (
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31 ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
      ) {
        errors.push(`${label}的 start 超出有效范围：${JSON.stringify(start)}`);
      }
    }

    if (!event.duration && !event.end) {
      errors.push(`${label}缺少 duration 或 end`);
    }
    if (event.duration) {
      const durationValues = Object.values(event.duration).filter(
        (value) => value !== undefined && value !== null
      );
      if (durationValues.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
        errors.push(`${label}的 duration 含有无效值：${JSON.stringify(event.duration)}`);
      }
    }
    if (event.startInputType && !["local", "utc"].includes(event.startInputType)) {
      errors.push(`${label}的 startInputType 无效：${event.startInputType}`);
    }
    if (event.startOutputType && !["local", "utc"].includes(event.startOutputType)) {
      errors.push(`${label}的 startOutputType 无效：${event.startOutputType}`);
    }
  });

  if (errors.length > 0) {
    throw new Error(errors.join("；"));
  }
};

const createCalendar = async (
  events: ics.EventAttributes[]
): Promise<string> => {
  validateCalendarEvents(events);
  const result = ics.createEvents(events);

  if (result.error) {
    const details = formatError(result.error);
    throw new Error(
      `iCalendar 库拒绝了事件数据：${details === "[object Object]" ? "底层库未提供详细原因" : details}`
    );
  }
  if (!result.value) {
    throw new Error("iCalendar 库没有返回内容");
  }

  return result.value;
};

const saveCalendar = async (value: string): Promise<void> => {
  if (fs.existsSync(outputFilename)) {
    const answer = await inquirer.prompt<{ overwrite: boolean }>({
      type: "confirm",
      name: "overwrite",
      message: `File [${outputFilename}] exists. Overwrite?`,
      default: true,
    });

    if (!answer.overwrite) {
      console.log("已取消保存");
      return;
    }
  }

  fs.writeFileSync(outputFilename, value, "utf8");
  console.log(`文件 [${outputFilename}] 已保存`);
};

const main = async (): Promise<void> => {
  const credentials = await getCredentials();
  if (!credentials.username || !credentials.password) {
    throw new Error("用户名和密码不能为空");
  }

  const loginSuccess = await runStage("登录请求失败", () =>
    login(credentials.username, credentials.password)
  );
  if (!loginSuccess) {
    process.exitCode = 1;
    return;
  }
  console.log(`登录成功：用户 ${credentials.username}`);

  const termPage = await runStage("获取期次失败", async () =>
    unwrap<ContentPage<Term>>(
      await GET<ContentPage<Term>>("/api/terms"),
      "/api/terms"
    )
  );
  const terms = Array.isArray(termPage?.content) ? termPage.content : [];
  const term =
    terms.find(
      (item) => item.currentTerm === 1 || String(item.currentTerm) === "1"
    ) ?? terms[0];

  if (!term) {
    throw new Error("没有找到可用的教学期次");
  }

  const courses = await runStage("获取课程失败", async () =>
    unwrap<Course[]>(
      await GET<Course[]>("/api/courses/uid", {
        page: "-1",
        size: "-1",
        termId: term.id,
        uid: credentials.username,
      }),
      "/api/courses/uid"
    )
  );
  const course = Array.isArray(courses) ? courses[0] : undefined;

  if (!course) {
    throw new Error(`期次“${term.name}”下没有找到实验课程`);
  }

  const labPage = await runStage("获取实验安排失败", async () =>
    unwrap<ContentPage<LabRecord>>(
      await GET<ContentPage<LabRecord>>("/api/course/lab/students/full", {
        uid: credentials.username,
        page: "-1",
        size: "-1",
        termId: term.id,
        courseId: course.id,
      }),
      "/api/course/lab/students/full"
    )
  );
  const records = Array.isArray(labPage?.content) ? labPage.content : [];

  if (records.length === 0) {
    throw new Error(`课程“${course.courseName}”没有可导出的实验安排`);
  }

  const events = records.flatMap((record) => {
    try {
      return toIcsEvents(record, { termName: term.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      throw new Error(`实验记录 ${record.id} 无法转换：${message}`);
    }
  });

  const value = await runStage("生成 iCalendar 失败", () => createCalendar(events));
  console.log(`已获取 ${records.length} 条实验记录，生成 ${events.length} 个日历事件`);
  console.log(`期次：${term.name}，课程：${course.courseName}`);
  await runStage("保存 iCalendar 文件失败", () => saveCalendar(value));
};

main().catch((error) => {
  console.error("处理失败：", formatError(error));
  process.exitCode = 1;
});
