"use strict";
const i18n_1 = require("../../services/i18n");
const tutorials_1 = require("../../services/tutorials");
const help_1 = require("./help-desk");
const sec_1 = require("../../services/sec-check");

function buildGroups(scene) {
  const scenes = scene && tutorials_1.isTutorialScene(scene) ? [scene] : tutorials_1.TUTORIAL_SCENES.slice();
  return scenes
    .map((key) => ({
      key,
      title: i18n_1.t(tutorials_1.sceneTitleKey(key)),
      items: tutorials_1.TUTORIALS.filter((item) => item.scene === key).map((item) => ({
        id: item.id,
        title: i18n_1.t(item.titleKey),
        ready: !!item.videoUrl,
      })),
    }))
    .filter((group) => group.items.length > 0);
}

Page({
  data: Object.assign({}, i18n_1.i18nState(), {
    groups: [],
    selectedId: "",
    draft: "",
    deskTail: "m1",
    desk: [
      {
        id: 1,
        role: "help",
        text: "点上面一条帮助文件，步骤会出现在这里。也可以直接问怎么做。",
        playId: "",
      },
    ],
  }),

  _scene: "",
  _seq: 1,
  _busy: false,

  onLoad(query) {
    this._scene = String((query && query.scene) || "");
    i18n_1.bindPageI18n(this, "tutorials");
    this.apply();
  },

  onShow() {
    this.apply();
  },

  apply() {
    const groups = buildGroups(this._scene);
    const title =
      this._scene && tutorials_1.isTutorialScene(this._scene)
        ? i18n_1.t(tutorials_1.sceneTitleKey(this._scene))
        : i18n_1.t("tutorials");
    wx.setNavigationBarTitle({ title });
    this.setData({ groups });
  },

  onOpen(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || "");
    if (!id) return;
    const ready = e.currentTarget.dataset.ready === true || e.currentTarget.dataset.ready === "true";
    const hit = help_1.helpForTutorial(id);
    const mid = ++this._seq;
    const desk = (this.data.desk || []).concat([
      {
        id: mid,
        role: "help",
        text: hit.text,
        playId: ready ? id : "",
      },
    ]);
    this.setData({
      selectedId: id,
      desk,
      deskTail: "m" + mid,
    });
  },

  onPlay(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || "");
    if (!id) return;
    wx.navigateTo({ url: "/pages/tutorials/play?id=" + encodeURIComponent(id) });
  },

  onDraft(e) {
    this.setData({ draft: e.detail.value });
  },

  async onAsk() {
    if (this._busy) return;
    const text = String(this.data.draft || "").trim();
    if (!text) {
      wx.showToast({ title: "先写要问的用法", icon: "none" });
      return;
    }
    this._busy = true;
    try {
      const ok = await sec_1.assertMsgSecCheck([text]);
      if (!ok) return;
      const hit = help_1.findHelp(text);
      const mine = ++this._seq;
      const reply = ++this._seq;
      const desk = (this.data.desk || []).concat([
        { id: mine, role: "me", text, playId: "" },
        { id: reply, role: "help", text: hit.text, playId: hit.playId || "" },
      ]);
      this.setData({
        desk,
        draft: "",
        deskTail: "m" + reply,
      });
    } finally {
      this._busy = false;
    }
  },
});
