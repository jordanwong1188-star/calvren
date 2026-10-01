export const scenarios = {
  "real-estate": "Hi, I’m Jamie. We’re looking for a two-bedroom home and would like to arrange a viewing this weekend. Our budget is around £350,000. What’s the next step?",
  "local-services": "Hi, I’m Alex. I’d like a quote for a new AC unit at our home. Could someone come by next week? What details do you need?",
  professional: "Hi, I’m Morgan. I run a small business and need help with bookkeeping and my tax return. Can we arrange an initial consultation next week?"
};
export function previewEnquiry(enquiry, businessType) {
  if (typeof enquiry !== "string" || enquiry.trim().length < 15 || enquiry.length > 2000) throw new Error("Please enter a message between 15 and 2,000 characters.");
  if (!Object.hasOwn(scenarios, businessType)) throw new Error("Choose one of the example industries.");
  const text = enquiry.trim();
  const lower = text.toLowerCase();
  const nameMatch = text.match(/\b(?:[Ii]['’]m|[Ii] am|[Mm]y name is)\s+([A-Z][a-zA-Z'-]{1,30})(?=[.,!\s]|$)/);
  const greeting = nameMatch ? "Hi " + nameMatch[1] + "," : "Hello,";
  const time = lower.match(/\b(?:this weekend|next week|this week|tomorrow|today|as soon as possible)\b/);
  const urgent = /\b(?:urgent|emergency|asap)\b/.test(lower) && !/\b(?:not|isn't|isn’t|no)\s+(?:an?\s+)?(?:urgent|emergency)\b/.test(lower);
  const tags = ["Example rules", "For review"];
  if (time) tags.push(time[0].charAt(0).toUpperCase() + time[0].slice(1));
  if (urgent) tags.push("Review urgency");
  let intent = "General enquiry", summary = "A new enquiry needs clarification before the next step can be agreed.";
  let missing = "The service needed, relevant background and preferred contact details.";
  let reply = greeting + " thanks for getting in touch. Could you share a little more about what you need and your preferred contact details? Our team can then review the request and suggest the next step.";
  let nextAction = "Prepare an enquiry record for review. Clarify the request before proposing a service or appointment.";
  if (businessType === "real-estate") {
    if (/\b(?:sell|selling|valuation|appraisal)\b/.test(lower)) {
      intent = "Seller / valuation enquiry";
      summary = "The sender is asking about selling a property or arranging a valuation.";
      missing = "Property address, property type and preferred times for an initial conversation.";
      reply = greeting + " thanks for your enquiry. Could you share the property address, a brief description and a couple of times that suit you for an initial conversation? Our team can then review the details and discuss the valuation process.";
      nextAction = "Propose a seller enquiry record with status “Awaiting details”. Flag it for an agent to review before confirming a valuation.";
    } else if (/\b(?:view|viewing|buy|buyer|looking|bedroom|rent|rental)\b|two-bedroom/.test(lower)) {
      const rental = /\b(?:rent|rental|tenant|letting)\b/.test(lower);
      intent = rental ? "Rental / viewing enquiry" : "Buyer / viewing enquiry";
      summary = "The sender is interested in a property and needs help with the next step" + (time ? " " + time[0] : "") + ".";
      missing = "The property reference or area of interest, preferred viewing times and contact details.";
      reply = greeting + " thanks for getting in touch. Could you share the property reference or area you’re interested in and a couple of preferred viewing times" + (time ? " " + time[0] : "") + "? Please include your preferred contact details. Our team can then check availability and confirm the next step.";
      nextAction = "Propose a viewing enquiry record with status “Awaiting details”. Ask an agent to check availability. Consider a follow-up after 24 hours if no reply arrives.";
    }
  } else if (businessType === "local-services") {
    if (/\b(?:quote|estimate|repair|install|installation|ac unit|cleaning|plumbing|service|boiler|leak)\b/.test(lower)) {
      intent = /\b(?:quote|estimate)\b/.test(lower) ? "Service / quote request" : "Service request";
      const service = /\b(?:ac unit|air conditioning)\b/.test(lower) ? "air conditioning" : /\b(?:boiler)\b/.test(lower) ? "a boiler" : /\b(?:plumbing|leak)\b/.test(lower) ? "plumbing" : /\b(?:cleaning)\b/.test(lower) ? "cleaning" : "a local service";
      summary = "The sender needs help with " + service + (time ? " " + time[0] : "") + ". The team needs more details before confirming scope or availability.";
      missing = "Service address, a short description of the work and preferred contact details.";
      reply = greeting + " thanks for getting in touch about " + service + ". Could you share the service address, a little more about the work and a couple of suitable times" + (time ? " " + time[0] : "") + "? Our team can review the details before confirming availability or a quote.";
      nextAction = "Propose a service enquiry record with status “Awaiting details”. Review the scope before offering a quote. Consider a follow-up after 24 hours if no reply arrives.";
    }
  } else if (/\b(?:consultation|bookkeeping|tax|accounting|legal|advice|business|onboarding)\b/.test(lower)) {
    intent = "Professional service / intake";
    summary = "The sender wants professional support and an initial conversation" + (time ? " " + time[0] : "") + ". Service suitability needs a team review.";
    missing = "The service required, business or personal context and preferred contact details. Request confidential documents only through an agreed secure channel.";
    reply = greeting + " thanks for your enquiry. Could you share a brief overview of the support you need and your preferred contact details and times for an initial conversation" + (time ? " " + time[0] : "") + "? Please leave out confidential documents for now. Our team can review the request and discuss the next step.";
    nextAction = "Propose an intake record with status “Needs team review”. Check service suitability before confirming a consultation.";
  }
  if (urgent) nextAction = "Flag for prompt human review. The example cannot assess emergencies or guarantee a response time. " + nextAction;
  return {mode:"example",businessType,intent,summary,missing,replyDraft:reply,nextAction,tags,enquiry:text};
}
