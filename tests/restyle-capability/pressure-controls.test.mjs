import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { inspectControls } from "../../scripts/checks/restyle-capability/pressure-controls.mjs";

test(
  "pressure browser grading accepts ARIA/native labels and rejects unlabeled or overflowing controls",
  { skip: !process.env.RESTYLE_PRESSURE_UI_JOURNAL, timeout: 30000 },
  async () => {
    const resource = {
      kind: "browser",
      name: "pressure-label-calibration",
      cleaned: false,
    };
    const save = () =>
      writeFile(
        process.env.RESTYLE_PRESSURE_UI_JOURNAL,
        JSON.stringify(resource, null, 2),
        { mode: 0o600 },
      );
    await save();
    const browser = await chromium.launch({
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      for (const html of [
        '<input type="number" name="answer" aria-label="Answer" placeholder="Answer"><button>Check</button>',
        '<label>Feedback<input name="feedback"></label><button>Save</button>',
        '<span id="name">ملاحظاتك الخاصة</span><input name="feedback" aria-labelledby="name"><button>Save</button>',
      ]) {
        await page.setContent(html);
        const rows = [];
        await inspectControls(page, async (_kind, data) => rows.push(data));
        assert.equal(rows[0].facts.length, 2);
        assert.ok(rows[0].facts[0].label);
      }
      for (const html of [
        '<input name="answer"><button>Check</button>',
        '<input aria-label="Answer" style="width:900px"><button>Check</button>',
      ]) {
        await page.setContent(html);
        await assert.rejects(
          inspectControls(page, async () => {}),
          /accessible label/,
        );
      }
    } finally {
      await browser.close();
      resource.cleaned = true;
      await save();
    }
  },
);
