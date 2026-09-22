import { test, expect } from "@playwright/test";

test("真实集群导航、发消息、回放与磁盘文件", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await request.post("/api/initialize");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "集群实时拓扑" }),
  ).toBeVisible();
  await expect(page.getByText("集群在线", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "消息工作台", exact: true }).click();
  const key = `browser-${Date.now()}`;
  await page.getByLabel("消息 Key", { exact: true }).fill(key);
  await page.getByLabel("消息数量", { exact: true }).fill("3");
  await page.getByLabel("目标分区", { exact: true }).selectOption("0");
  await page.getByRole("button", { name: "发送事件", exact: true }).click();
  await expect(page.locator(".receipt-summary")).toContainText("已确认");
  await expect(page.locator(".receipt-table tbody tr")).toHaveCount(3);
  const offset = await page
    .locator(".receipt-table tbody tr")
    .first()
    .locator("td")
    .last()
    .textContent();
  await page.getByLabel("起始 Offset", { exact: true }).fill(offset!);
  await page.getByRole("button", { name: "读取日志", exact: true }).click();
  await expect(page.locator(".event-list")).toContainText(key);
  await page.screenshot({
    path: "test-results/messages-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "消费者与位移", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "lab-fulfillment", exact: true }),
  ).toBeVisible();
  const group = page
    .locator(".panel")
    .filter({
      has: page.getByRole("heading", { name: "lab-fulfillment", exact: true }),
    });
  await group.getByRole("button", { name: "增加消费者", exact: true }).click();
  const worker = group.locator(".worker").last();
  await expect(worker).toContainText("running", { timeout: 20000 });
  await worker.getByRole("combobox").selectOption("500");
  await expect(worker.getByRole("combobox")).toHaveValue("500");
  await worker.getByRole("button", { name: /^停止 / }).click();
  await expect(worker).toContainText("stopped", { timeout: 15000 });
  await page.getByRole("button", { name: "持久化日志", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: /^\d+\.log$/ }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "架构实验室", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Active Controller 选举", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("移动端导航可用且页面不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "集群实时拓扑" }),
  ).toBeVisible();
  for (const name of [
    "架构总览",
    "消息工作台",
    "消费者与位移",
    "持久化日志",
    "架构实验室",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "架构总览", exact: true }).click();
  await page.screenshot({
    path: "test-results/overview-mobile.png",
    fullPage: true,
  });
});
