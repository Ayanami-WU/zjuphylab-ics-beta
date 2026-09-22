import { getTimestamp } from "./util/zjuphylab-timestamp";

const md5 = require("js-md5");

const APPKEY = "eb8c68399de7483abb2d8abaea0d039f";
const dumpedKey = "7cd476ab866b49d7a9788ad9f4789495";

const host = "http://10.203.16.55:8098/lab-course";

export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message?: string;
}

interface LoginData {
  name?: string;
  token?: {
    access_token?: string;
    token_type?: string;
  };
}

type RequestData = Record<string, unknown>;

let Authorization = "";

const isPresent = (value: unknown): boolean =>
  value !== "" && value !== null && value !== undefined;

const toData = (path: string, data: RequestData = {}): string => {
  const timestamp = getTimestamp();
  const signData = Object.entries(data)
    .filter(([, value]) => isPresent(value) && typeof value !== "object")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => key + String(value))
    .join("");

  const params = new URLSearchParams({
    app_key: APPKEY,
    timestamp: String(timestamp),
    sign: md5(dumpedKey + path + signData + timestamp + " " + dumpedKey),
  });

  for (const [key, value] of Object.entries(data)) {
    if (isPresent(value)) {
      params.set(key, String(value));
    }
  }

  return params.toString();
};

const readResponse = async <T>(response: Response): Promise<ApiResponse<T>> => {
  const text = await response.text();
  let result: unknown;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`接口返回了无法解析的响应（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    throw new Error(`接口请求失败（HTTP ${response.status}）`);
  }

  if (
    !result ||
    typeof result !== "object" ||
    !("code" in result) ||
    typeof result.code !== "number"
  ) {
    throw new Error("接口返回格式不符合预期");
  }

  return result as ApiResponse<T>;
};

async function login(username: string, password: string): Promise<boolean> {
  const path = "/api/login";
  const response = await fetch(host + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: toData(path, {
      username,
      password,
    }),
  });
  const result = await readResponse<LoginData>(response);
  const token = result.data?.token;

  if (result.code !== 200 || !token?.access_token || !token.token_type) {
    Authorization = "";
    console.error("登录失败：", result.message ?? `Code=${result.code}`);
    return false;
  }

  Authorization = token.token_type + " " + token.access_token;
  return true;
}

function GET<T = unknown>(
  path: string,
  data: RequestData = {}
): Promise<ApiResponse<T>> {
  return fetch(host + path + "?" + toData(path, data), {
    headers: {
      Authorization,
    },
  }).then((response) => readResponse<T>(response));
}

function POST<T = unknown>(
  path: string,
  data: RequestData = {}
): Promise<ApiResponse<T>> {
  return fetch(host + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Authorization,
    },
    body: toData(path, data),
  }).then((response) => readResponse<T>(response));
}

export { GET, POST, login };
