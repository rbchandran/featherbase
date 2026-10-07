# Sales Target Report Delta

## ADDED Requirements

### Requirement: A Dive can be given to one person

An administrator SHALL be able to give one named person one more Dive, a MotherDuck report
page, at a fixed version, and that person SHALL be able to open it from their report.
Nobody else SHALL be able to open it, and being refused SHALL not reveal whether it exists.

#### Scenario: The Attakulangara Store Manager opens the store cockpit

- **WHEN** the store cockpit is given to the Attakulangara Store Manager and they open it from their report
- **THEN** they see the cockpit at the version they were given

#### Scenario: Someone else tries the same page

- **WHEN** another reader opens the address of the Store Manager's cockpit
- **THEN** they are told it is not assigned to them, and nothing is shown

### Requirement: A person with only a Dive lands on it

When a person has no report of their own but has been given a Dive, signing in SHALL take them
straight to that Dive.

#### Scenario: A manager with only a cockpit signs in

- **WHEN** a person whose only report is a Dive given to them signs in
- **THEN** they land on that Dive
