import test from "node:test";
import assert from "node:assert/strict";
import {scenarios,previewEnquiry} from "../public/demo-engine.js";
test("buyer enquiry prepares a viewing request without promising a booking",()=>{
  const result=previewEnquiry(scenarios["real-estate"],"real-estate");
  assert.equal(result.intent,"Buyer / viewing enquiry");
  assert.match(result.replyDraft,/^Hi Jamie,/);
  assert.match(result.nextAction,/check availability/);
  assert.doesNotMatch(result.replyDraft,/booked|confirmed your/);
});
test("seller and valuation requests go to agent review",()=>{
  const result=previewEnquiry("I want to sell my property and arrange a valuation.","real-estate");
  assert.equal(result.intent,"Seller / valuation enquiry");
  assert.match(result.nextAction,/agent to review/);
});
test("an unclear enquiry asks for clarification rather than guessing",()=>{
  const result=previewEnquiry("Hello, could you tell me more about your company?","real-estate");
  assert.equal(result.intent,"General enquiry");
  assert.match(result.replyDraft,/more about what you need/);
});
test("local service quote asks for a service address before scope is confirmed",()=>{
  const result=previewEnquiry(scenarios["local-services"],"local-services");
  assert.match(result.missing,/Service address/);
  assert.match(result.replyDraft,/before confirming/);
});
test("professional intake avoids requesting confidential documents in a first reply",()=>{
  assert.match(previewEnquiry(scenarios.professional,"professional").replyDraft,/leave out confidential documents/);
});
test("non-urgent wording does not trigger urgency escalation",()=>{
  assert.ok(!previewEnquiry("This is not urgent. I need a quote for cleaning.","local-services").tags.includes("Review urgency"));
});
test("unknown sender is not given an invented name",()=>{
  assert.match(previewEnquiry("I am looking for a property viewing this weekend.","real-estate").replyDraft,/^Hello,/);
});
test("untrusted HTML does not flow into the generated reply",()=>{
  assert.ok(!previewEnquiry("<img src=x onerror=alert(1)> I need a quote for plumbing.","local-services").replyDraft.includes("<img"));
});
test("invalid, oversized or unsupported requests fail clearly",()=>{
  assert.throws(()=>previewEnquiry("short","real-estate"));
  assert.throws(()=>previewEnquiry("a".repeat(2001),"professional"));
  assert.throws(()=>previewEnquiry("A message with sufficient characters.","unknown"));
});
