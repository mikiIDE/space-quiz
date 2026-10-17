const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class TestElement {
  constructor(tagName, document) {
    this.tagName = tagName;
    this.document = document;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.style = {};
    this.classNames = new Set();
    this.classList = {
      add: name => this.classNames.add(name)
    };
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this._textContent = "";
    this._innerHTML = "";
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value);
    this._innerHTML = "";
    this.children = [];
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this._textContent = "";
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  append(...nodes) {
    for (const node of nodes) {
      this.children.push(typeof node === "string" ? this.document.createTextNode(node) : node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  addEventListener(type, callback) {
    this.listeners[type] ??= [];
    this.listeners[type].push(callback);
  }

  click() {
    if (this.disabled) return;
    for (const callback of this.listeners.click ?? []) callback();
  }

  focus() {
    this.document.activeElement = this;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  querySelectorAll(selector) {
    if (selector !== ".answer") throw new Error(`Unexpected selector: ${selector}`);
    return this.children.filter(child => child.className.split(/\s+/).includes("answer"));
  }
}

class TestDocument {
  constructor() {
    this.activeElement = null;
    this.elements = new Map();
    const ids = [
      "quiz-screen",
      "results-screen",
      "question-number",
      "question",
      "answers",
      "score",
      "progress-fill",
      "feedback",
      "continue-button",
      "reaction",
      "result-title",
      "result-copy",
      "final-score",
      "restart-button",
      "review-section",
      "review-list",
      "results-announcement"
    ];
    for (const id of ids) this.elements.set(`#${id}`, new TestElement("div", this));
    this.elements.set(".progress-track", new TestElement("div", this));
  }

  querySelector(selector) {
    const element = this.elements.get(selector);
    if (!element) throw new Error(`Unexpected selector: ${selector}`);
    return element;
  }

  createElement(tagName) {
    return new TestElement(tagName, this);
  }

  createTextNode(text) {
    const node = new TestElement("#text", this);
    node.textContent = text;
    return node;
  }
}

function createQuiz() {
  const htmlPath = path.join(__dirname, "..", "index.html");
  const html = readFileSync(htmlPath, "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "index.html should contain the quiz script");

  const document = new TestDocument();
  const context = vm.createContext({ document });
  vm.runInContext(script, context, { filename: "index.html" });
  return { context, document };
}

function finishQuiz(context, document, incorrectQuestionNumbers = new Set()) {
  const questions = vm.runInContext(
    "questions.map(({ correct, answers }) => ({ correct, answerCount: answers.length }))",
    context
  );
  const answers = document.querySelector("#answers");
  const continueButton = document.querySelector("#continue-button");

  questions.forEach((question, index) => {
    const selected = incorrectQuestionNumbers.has(index)
      ? (question.correct + 1) % question.answerCount
      : question.correct;
    answers.children[selected].click();
    continueButton.click();
  });
}

test("shows each incorrect question, selected answer, and correct answer without changing the score", () => {
  const { context, document } = createQuiz();
  const questions = vm.runInContext("questions", context);
  const incorrectQuestionNumbers = new Set([0, 3]);

  finishQuiz(context, document, incorrectQuestionNumbers);

  const review = document.querySelector("#review-section");
  const items = document.querySelector("#review-list").children;
  assert.equal(document.querySelector("#final-score").textContent, "8/10");
  assert.equal(review.hidden, false);
  assert.equal(items.length, incorrectQuestionNumbers.size);
  for (const [reviewIndex, questionIndex] of [...incorrectQuestionNumbers].entries()) {
    const question = questions[questionIndex];
    const selectedIndex = (question.correct + 1) % question.answers.length;
    assert.ok(items[reviewIndex].textContent.includes(question.question));
    assert.ok(items[reviewIndex].textContent.includes(question.answers[selectedIndex]));
    assert.ok(items[reviewIndex].textContent.includes(question.answers[question.correct]));
  }
  assert.equal(document.activeElement, document.querySelector("#restart-button"));
});

test("hides the incorrect-answer list and announces a perfect score", () => {
  const { context, document } = createQuiz();

  finishQuiz(context, document);

  assert.equal(document.querySelector("#final-score").textContent, "10/10");
  assert.equal(document.querySelector("#review-section").hidden, true);
  assert.equal(document.querySelector("#review-list").children.length, 0);
  assert.match(document.querySelector("#results-announcement").textContent, /全問正解/);
});

test("clears incorrect-answer history when restarting", () => {
  const { context, document } = createQuiz();
  finishQuiz(context, document, new Set([0]));

  document.querySelector("#restart-button").click();

  assert.equal(document.querySelector("#score").textContent, "0");
  assert.equal(document.querySelector("#review-section").hidden, true);
  assert.equal(document.querySelector("#review-list").children.length, 0);
  assert.equal(document.activeElement, document.querySelector("#question"));

  finishQuiz(context, document);

  assert.equal(document.querySelector("#final-score").textContent, "10/10");
  assert.equal(document.querySelector("#review-section").hidden, true);
  assert.equal(document.querySelector("#review-list").children.length, 0);
  assert.equal(document.activeElement, document.querySelector("#restart-button"));
});
