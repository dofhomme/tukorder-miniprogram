"use strict";
const cloud_print_1 = require("../../services/cloud-print");
const i18n_1 = require("../../services/i18n");

function rowOf(g) {
  return {
    clientId: g.clientId,
    name: (0, cloud_print_1.gatewayTitle)(g),
    printerName: String(g.printerName || "").trim(),
  };
}

Page({
  data: Object.assign(
    {
      loading: true,
      linked: false,
      linkName: "",
      linkId: "",
      hosts: [],
      hint: "",
    },
    (0, i18n_1.i18nState)(),
  ),

  _gen: 0,

  onShow() {
    (0, i18n_1.bindPageI18n)(this, "cloudPrinterTitle");
    wx.setNavigationBarTitle({ title: "云打印机" });
    this.refresh();
  },

  async refresh() {
    const gen = ++this._gen;
    this.setData({ loading: true, hint: "" });
    const saved = (0, cloud_print_1.loadCloudLink)();
    const gw = await (0, cloud_print_1.listGateways)();
    if (gen !== this._gen) return;
    const list = gw.gateways || [];
    const current = saved ? list.find((item) => item.clientId === saved.clientId) : undefined;
    const online = list.filter((item) => item.online);
    if (current && current.online) (0, cloud_print_1.saveCloudLink)(current);
    if (gen !== this._gen) return;
    const linked = !!(current && current.online);
    const linkId = (linked ? current && current.clientId : saved && saved.clientId) || "";
    const hosts = online.filter((item) => item.clientId !== linkId).map(rowOf);
    let hint = "";
    if (!gw.ok) hint = gw.error || "读取失败";
    else if (!hosts.length && !linked) {
      hint = "团队里没有在线的云打印。请在电脑端打开「云打印机」，名称用电脑上保存的显示名。";
    }
    this.setData({
      loading: false,
      linked,
      linkId,
      linkName: linked && current ? (0, cloud_print_1.gatewayTitle)(current) : (saved && saved.name) || "",
      hosts,
      hint,
    });
  },

  onPick(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || "");
    if (!id) return;
    if (id === this.data.linkId) {
      (0, cloud_print_1.clearCloudLink)();
      this.setData({ linked: false, linkId: "", linkName: "" });
      wx.showToast({ title: "已断开", icon: "none" });
      this.refresh();
      return;
    }
    if (this.data.loading) return;
    const hit = (this.data.hosts || []).find((item) => item.clientId === id);
    if (!hit) return;
    (0, cloud_print_1.saveCloudLink)({ clientId: hit.clientId, name: hit.name, online: true });
    wx.showToast({ title: "已连接", icon: "success" });
    this.refresh();
  },
});
