// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Learning, illustrativeSimilarity } from "./Learning";
import catalog from "../lib/learning/essentiaCatalog.json";
import type { Track } from "../lib/types";

afterEach(cleanup);
function mount(tracks: Track[] = []) {
  const props={tracks,audioPaths:{one:"authorized/one.mp3"},onOpenBuilder:vi.fn(),onOpenLab:vi.fn()};
  render(<Learning {...props}/>);return props;
}
it("teaches each package and distinguishes upstream features without running inference", async()=>{
  const user=userEvent.setup();const request=vi.fn();vi.stubGlobal("fetch",request);
  try {
    const props=mount();
    expect(screen.getByRole("heading",{name:"CLAP feature inventory"})).not.toBeNull();
    await user.selectOptions(screen.getByLabelText("Feature availability"),"Upstream only");
    expect(screen.getByRole("heading",{name:"Audio embeddings from arrays"})).not.toBeNull();
    expect(screen.queryByRole("heading",{name:"Audio embeddings from files"})).toBeNull();
    await user.click(screen.getByRole("button",{name:/MuQ \/ MuQ-MuLan/}));
    expect(screen.getByRole("heading",{name:"MuQ hidden states"})).not.toBeNull();
    expect(screen.getByLabelText("Feature availability")).toHaveProperty("value","all");
    await user.click(screen.getByRole("button",{name:"Open Semantic Lab →"}));
    expect(props.onOpenLab).toHaveBeenCalledOnce();
    expect(props.onOpenBuilder).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
it("changes the fictional ranking with query direction and labels the demo honestly", async()=>{
  mount();const slider=screen.getByLabelText("Query direction") as HTMLInputElement;
  expect(within(screen.getByRole("list",{name:"Illustrative similarity ranking"})).getAllByRole("listitem")[0].textContent).toContain("Amber");
  // Range keyboard behavior is browser-native; dispatch the React input event for this unit check.
  const {fireEvent}=await import("@testing-library/react");fireEvent.change(slider,{target:{value:"155"}});
  expect(within(screen.getByRole("list",{name:"Illustrative similarity ranking"})).getAllByRole("listitem")[0].textContent).toContain("Cobalt");
  expect(screen.getByText(/no model runs here/)).not.toBeNull();
  expect(illustrativeSimilarity(0,90)).toBeCloseTo(0);expect(illustrativeSimilarity(15,15)).toBeCloseTo(1);
});
it("searches the full pinned Essentia registry, including parameters and empty results", async()=>{
  const user=userEvent.setup();mount();await user.click(screen.getByRole("button",{name:"Essentia"}));
  expect(catalog.algorithms).toHaveLength(272);
  expect(new Set(catalog.algorithms.map(item=>item.name)).size).toBe(catalog.algorithms.length);
  await user.type(screen.getByLabelText("Search Essentia algorithms"),"MFCC");
  expect(screen.getByText("MFCC",{selector:"strong"})).not.toBeNull();
  await user.click(screen.getByText("MFCC",{selector:"strong"}));
  expect(within(screen.getByText("MFCC",{selector:"strong"}).closest("details")!).getByRole("link",{name:"standard documentation ↗"}).getAttribute("href")).toBe("https://essentia.upf.edu/reference/std_MFCC.html");
  await user.selectOptions(screen.getByLabelText("Essentia algorithm category"),"Filters");
  expect(screen.getByText(/No algorithms match/)).not.toBeNull();
});
it("inspects all 17 cached fields, missing values, and fixture provenance without fabricating Essentia results", async()=>{
  const user=userEvent.setup();mount([{id:"one",name:"Fictional track",artist:"Fixture artist",album:"Demo",genres:[],duration_ms:60000,explicit:false,audio_features:{tempo:120,arousal:0.4},audio_feature_provenance:{provider:"fixture"}}]);
  await user.click(screen.getByRole("button",{name:"Essentia"}));await user.selectOptions(screen.getByLabelText("Track to inspect"),"one");
  expect(screen.getByText(/Provider: fixture/)).not.toBeNull();
  const section=screen.getByRole("heading",{name:"Inspect actual measurements"}).closest("section")!;
  expect(section.querySelectorAll("dt")).toHaveLength(17);expect(within(section).getAllByText("Not available")).toHaveLength(15);
  expect(screen.getByLabelText("Learning preview Fictional track").getAttribute("preload")).toBe("none");
  expect(screen.getByLabelText("Calculated RMS").textContent).toBe("0.3536");
});
