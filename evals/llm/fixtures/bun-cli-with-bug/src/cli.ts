import { type Item, add, markDone, render } from "./todo";

const FILE = "todo.json";

async function load(): Promise<Item[]> {
    const file = Bun.file(FILE);
    return (await file.exists()) ? ((await file.json()) as Item[]) : [];
}

const [command, ...rest] = process.argv.slice(2);
let items = await load();

if (command === "add") items = add(items, rest.join(" "));
else if (command === "done") items = markDone(items, Number(rest[0]));
else if (command !== "list") {
    console.error("usage: todo add <title> | done <n> | list");
    process.exit(2);
}

await Bun.write(FILE, JSON.stringify(items, null, 2));
console.log(render(items));
