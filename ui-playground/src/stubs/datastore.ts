export const get = async (key: string) => JSON.parse(localStorage.getItem(`ds:${key}`) ?? "null") ?? undefined;
export const set = async (key: string, value: unknown) => localStorage.setItem(`ds:${key}`, JSON.stringify(value));
export const del = async (key: string) => localStorage.removeItem(`ds:${key}`);
