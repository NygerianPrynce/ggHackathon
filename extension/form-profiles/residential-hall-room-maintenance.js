/**
 * Structured form profile for "Residential Hall Room Maintenance Issue"
 * (ReADY template id nCNEaYerZReeEF9WK). Extracted from Stages Document.pdf —
 * schema keys and option values match the live form DOM.
 *
 * Loaded in the MV3 service worker via importScripts; exposed as a global.
 */
// eslint-disable-next-line no-var
var RESIDENTIAL_HALL_ROOM_MAINTENANCE = {
  templateId: "nCNEaYerZReeEF9WK",
  title: "Residential Hall Room Maintenance Issue",
  source: "Stages Document.pdf",

  stages: [
    {
      id: 1,
      label: "Emergency",
      fields: [
        {
          schemaKey: "emergency",
          domId: "emergency",
          type: "radio",
          label: "Is this an emergency? ( Fire, Flood, Complete loss of power)",
          options: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ],
        },
      ],
    },
    {
      id: 2,
      label: "Work type and details",
      fields: [
        {
          schemaKey: "workType",
          domId: "workType",
          type: "radio",
          label: "What type of work are you responding to?",
          help: "PLEASE SUBMIT ONE ISSSUE PER REQUEST",
          options: [
            { value: "doors/windows/blinds/ceilings", label: "Doors/Windows/Blinds/Ceilings" },
            { value: "elevators", label: "Elevators" },
            { value: "furniture", label: "Furniture" },
            { value: "appliance", label: "Appliance" },
            { value: "heat/air", label: "Heat/Air" },
            { value: "housekeeping", label: "Housekeeping" },
            { value: "light/electrical", label: "Light/Electrical" },
            { value: "pests", label: "Pests" },
            { value: "plumbing/water", label: "Plumbing/Water" },
            { value: "vending machine", label: "Vending Machine" },
            { value: "IT issues", label: "IT Issues" },
            { value: "surface discoloration", label: "Surface Discoloration" },
          ],
        },
      ],
      /** Conditional blocks keyed by workType value (order matters for branching UIs). */
      branches: {
        "doors/windows/blinds/ceilings": {
          fields: [
            {
              schemaKey: "doorsWindowsBlinds",
              domId: "doorsWindowsBlinds",
              type: "radio",
              label: "What is the problem area?",
              options: [
                { value: "ceiling damage", label: "Ceiling damage" },
                { value: "door issue", label: "Door issue" },
                { value: "window issue", label: "Window issue" },
                { value: "blinds issue", label: "Blinds Issue" },
              ],
            },
          ],
          nested: {
            "ceiling damage": {
              fields: [
                {
                  schemaKey: "ceiling",
                  domId: "ceiling",
                  type: "radio",
                  label: "What is the issue with the ceiling?",
                  options: [
                    { value: "water damage", label: "Water damage (discoloration)" },
                    { value: "missing tiles", label: "Missing tiles (broken tiles)" },
                    { value: "ceiling leaking", label: "Ceiling leaking" },
                  ],
                },
              ],
            },
            "door issue": {
              fields: [
                {
                  schemaKey: "door",
                  domId: "door",
                  type: "radio",
                  label: "What is your door issue?",
                  options: [
                    { value: "door hinge damage", label: "Door hing damage" },
                    { value: "door dragging when trying to shut", label: "Door dragging when trying to shut" },
                    { value: "door stopper issue", label: "Door stopper issue" },
                    {
                      value: "door lock issue",
                      label: "Door/Lock issue (If this is a security issue \"i.e door not locking\" please contact RA on duty)",
                    },
                    { value: "door closer adjustment", label: "Door closer adjustment" },
                    { value: "bathroom stall door", label: "Bathroom stall door" },
                    { value: "bi fold door out of track", label: "Bi fold door out of track" },
                  ],
                },
              ],
            },
            "window issue": {
              fields: [
                {
                  schemaKey: "windows",
                  domId: "windows",
                  type: "radio",
                  label: "What is your window problem?",
                  options: [
                    { value: "window not opening", label: "Window not opening" },
                    { value: "window not shutting properly", label: "Window not shutting properly" },
                    { value: "broken glass", label: "Broken glass" },
                    { value: "window leaking", label: "Window leaking" },
                    { value: "window pane damage", label: "Window pane damage" },
                  ],
                },
              ],
            },
            "blinds issue": {
              note: "Document snapshot shows only brief after blinds issue; no separate blinds sub-radio group.",
              fields: [],
            },
          },
        },
        elevators: {
          fields: [
            {
              schemaKey: "elevator",
              domId: "elevator",
              type: "radio",
              label: "Elevator issues",
              options: [
                { value: "elevator not moving", label: "Elevator is not moving" },
                { value: "door malfunction", label: "Door malfunction" },
                {
                  value: "elevator call up or down button is not working",
                  label: "Elevator call up or down button is not working",
                },
                {
                  value: "elevator call up or down button is not working",
                  label: "Elevator call up or down button is not working (public floor)",
                  note: "Same value as previous option in DOM; distinct radio id in form.",
                },
                { value: "excessive noise", label: "Excessive noise" },
                { value: "elevator feels unsteady", label: "Elevator feels unsteady" },
              ],
            },
          ],
        },
        furniture: {
          fields: [
            {
              schemaKey: "furniture",
              domId: "furniture",
              type: "radio",
              label: "What furniture is having issues?",
              options: [
                { value: "bed", label: "Bed" },
                { value: "desk", label: "Desk" },
                { value: "dresser", label: "Dresser" },
                { value: "chair", label: "Chair" },
                { value: "lamp", label: "Lamp" },
                { value: "closet", label: "Closet" },
                { value: "bedrails/bed ladders", label: "Bedrails/Bed ladders" },
              ],
            },
          ],
        },
        appliance: {
          fields: [
            {
              schemaKey: "appliance",
              domId: "appliance",
              type: "radio",
              label: "What appliance is having issues?",
              options: [
                { value: "refrigerator", label: "Refrigerator" },
                { value: "stove", label: "Stove" },
                { value: "washer/dryer", label: "Washer/Dryer" },
                { value: "disposal", label: "Disposal" },
                { value: "dishwasher", label: "Dishwasher" },
                { value: "microwave", label: "Microwave" },
              ],
            },
          ],
        },
        "heat/air": {
          fields: [
            {
              schemaKey: "heatAir",
              domId: "heatAir",
              type: "radio",
              label: "What is your heating/air issue?",
              options: [
                { value: "room is too hot", label: "Too hot" },
                { value: "room is too cold", label: "Too cold" },
                { value: "thermostat issues", label: "Thermostat" },
                { value: "noise", label: "Noise" },
              ],
            },
            {
              schemaKey: "thermostat",
              domId: "thermostat",
              type: "text",
              label: "What is the thermostat issue?",
              showWhen: { schemaKey: "heatAir", equals: "thermostat issues" },
            },
          ],
        },
        housekeeping: {
          fields: [
            {
              schemaKey: "houseKeeping",
              domId: "houseKeeping",
              type: "radio",
              label: "What is the housekeeping issue?",
              options: [
                { value: "cleaning missed", label: "Cleaning missed" },
                { value: "toilet paper needed", label: "Toilet paper needed" },
                { value: "shower curtain needed", label: "Shower curtain needed" },
              ],
            },
            {
              schemaKey: "cleanDate",
              domId: "cleanDate",
              type: "date",
              label: "When was the last date cleaned?",
              showWhen: { schemaKey: "houseKeeping", equals: "cleaning missed" },
            },
          ],
        },
        "light/electrical": {
          fields: [
            {
              schemaKey: "electrical",
              domId: "electrical",
              type: "radio",
              label: "What is the electrical issue?",
              options: [
                { value: "light out", label: "Light out" },
                { value: "power outage/outlet not working", label: "Power outage/outlet not working" },
                { value: "electrical switch not responding", label: "Electrical switch not responding" },
              ],
            },
            {
              schemaKey: "outage",
              domId: "outage",
              type: "radio",
              label: "What is the degree out outage?",
              options: [
                { value: "whole room", label: "Whole room" },
                { value: "single outlet", label: "Single outlet" },
              ],
              showWhen: { schemaKey: "electrical", equals: "power outage/outlet not working" },
            },
          ],
        },
        pests: {
          fields: [
            {
              schemaKey: "pest",
              domId: "pest",
              type: "radio",
              label: "What pest control service would you like to request?",
              options: [
                { value: "area needs to be treated for pest", label: "Area needs to be treated for pest" },
                { value: "pest needs to be removed", label: "Pest needs to be removed" },
                { value: "nest needs to be removed", label: "Nest needs to be removed" },
              ],
            },
            {
              schemaKey: "pestType",
              domId: "pestType",
              type: "checkbox",
              label: "What type of pest is this?",
              options: [
                { value: "Rats/mouse", label: "Rats/mouse" },
                { value: "Birds/bats", label: "Birds/bats" },
                { value: "Snake", label: "Snake" },
                { value: "Lizard", label: "Lizard" },
                { value: "Insects", label: "Insects" },
                { value: "Squirrels", label: "Squirrels" },
                { value: "Spiders", label: "Spiders" },
                { value: "Possums", label: "Possums" },
              ],
            },
          ],
        },
        "plumbing/water": {
          fields: [
            {
              schemaKey: "plumbing",
              domId: "plumbing",
              type: "radio",
              label: "What is the plumbing issue?",
              options: [
                { value: "clogged sink/drain/toilet", label: "Clogged sink/drain/toilet" },
                { value: "water not running", label: "Water not running/toilet not flushing" },
                { value: "water continuously running", label: "Water continuously running" },
                { value: "leaking faucet/sink/pipe", label: "Leaking faucet/sink/pipe" },
                { value: "no hot water", label: "No hot water" },
                { value: "no cold water", label: "No cold water" },
                { value: "cracked/damaged sink/shower/tub/toilet", label: "Cracked/Damaged sink/shower/tub/toilet" },
                { value: "hydration station issue", label: "Hydration station issue" },
              ],
            },
          ],
        },
        "vending machine": {
          note: "Only workType + brief in document snapshot.",
          fields: [],
        },
        "IT issues": {
          fields: [
            {
              schemaKey: "comcast",
              domId: "comcast-id-label",
              type: "static",
              label:
                "Selecting this option will not created a service ticket. Comcast / network: 844-790-6935, xcsupport@comcast.com. Other IT: 615-343-9999 or it.vanderbilt.edu.",
            },
          ],
        },
        "surface discoloration": {
          fields: [
            {
              schemaKey: "surfaceDiscoloration",
              domId: "surfaceDiscoloration",
              type: "radio",
              label: "Where is the surface discoloration?",
              options: [
                { value: "on ceiling", label: "Ceiling" },
                { value: "on the walls", label: "Walls" },
                { value: "on the floor", label: "Floor" },
                { value: "behind furniture", label: "Behind furniture" },
                { value: "", label: "Other", note: "DOM radio has no value attribute for Other" },
              ],
            },
            {
              schemaKey: "surfaceOther",
              domId: "surfaceOther",
              type: "text",
              label: "Where is the surface discoloration located?",
              showWhen: { schemaKey: "surfaceDiscoloration", isOther: true },
            },
            {
              schemaKey: "discolorationDisclaimer",
              domId: "discolorationDisclaimer-id-label",
              type: "static",
              label: "Please attach photo of surface discoloration",
            },
          ],
        },
      },
      /** Shown for every workType path on stage 2 before Next. */
      commonTail: [
        {
          schemaKey: "brief",
          domId: "brief",
          type: "textarea",
          label: "Describe what is needed in order to get the requested work completed.",
        },
      ],
    },
    {
      id: 3,
      label: "After hours + location",
      fields: [
        {
          schemaKey: "timeWarning",
          type: "static",
          label:
            "You are entering a request after hours and the quickest we will respond is next business day. If you need immediate assistance, please call your RA on duty.",
        },
        {
          schemaKey: "acknowledge",
          domId: "acknowledge",
          type: "checkbox",
          label:
            "Before you proceed do you acknowledge that this request is outside of business hours, and may not be responded to immediately?",
          options: [{ value: "yes", label: "Yes" }],
        },
        {
          schemaKey: "yourName",
          domId: "yourName",
          type: "text",
          label: "Thank you for using ReADY",
          note: "Read-only / disabled in form snapshot.",
        },
        {
          schemaKey: "location|Property|bldg",
          domId: "locationPropertybldg",
          type: "select2",
          label: "Building, property, structure",
        },
        {
          schemaKey: "location|Floor|flrId",
          domId: "locationFloorflrId",
          type: "select2",
          label: "Floor",
        },
        {
          schemaKey: "location|Location|locId",
          domId: "locationLocationlocId",
          type: "select2",
          label: "Location",
        },
      ],
    },
    {
      id: 4,
      label: "Review",
      fields: [
        {
          schemaKey: "workOrderDescription",
          domId: "workOrderDescription",
          type: "text",
          label: "Work Order Description",
          note: "Read-only in review.",
          readonly: true,
        },
        { schemaKey: "contactName", domId: "contactName", type: "text", label: "Contact Name" },
        { schemaKey: "contactNumber", domId: "contactNumber", type: "text", label: "Contact Number" },
        { schemaKey: "contactEmail", domId: "contactEmail", type: "text", label: "Contact Email" },
        {
          schemaKey: "woDescriptionForMapping",
          domId: "woDescriptionForMapping",
          type: "text",
          label: "Work Order Description",
          note: "Second WO description field; read-only.",
          readonly: true,
        },
      ],
      actions: [{ domId: "requestScreenReview", label: "Review", type: "button" }],
    },
    {
      id: 5,
      label: "Submit",
      actions: [{ domId: "requestScreenInsert", label: "Submit", type: "submit" }],
    },
  ],

  /** Primary navigation control ids shared across stages. */
  nav: {
    next: "requestScreenNext",
    previous: "requestScreenPrevious",
    cancel: "requestScreenCancel",
    review: "requestScreenReview",
    submit: "requestScreenInsert",
  },
};
