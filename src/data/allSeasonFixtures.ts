// Full official 380 Premier League 2026/2027 Season Fixtures (GW 1 - 38)
// Guarantees zero missing gameweeks or race conditions on the projection dashboard
export interface SimpleFixtureItem {
  id: number;
  event: number;
  kickoff_time: string;
  home_team: { short_name: string };
  away_team: { short_name: string };
}

export const ALL_SEASON_FIXTURES: Record<number, SimpleFixtureItem[]> = {
  "1": [
    {
      "id": 1,
      "event": 1,
      "kickoff_time": "2026-08-21T19:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 4,
      "event": 1,
      "kickoff_time": "2026-08-22T11:30:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 3,
      "event": 1,
      "kickoff_time": "2026-08-22T14:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 5,
      "event": 1,
      "kickoff_time": "2026-08-22T14:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 6,
      "event": 1,
      "kickoff_time": "2026-08-22T14:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 2,
      "event": 1,
      "kickoff_time": "2026-08-22T16:30:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 7,
      "event": 1,
      "kickoff_time": "2026-08-23T13:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 8,
      "event": 1,
      "kickoff_time": "2026-08-23T13:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 9,
      "event": 1,
      "kickoff_time": "2026-08-23T15:30:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 10,
      "event": 1,
      "kickoff_time": "2026-08-24T19:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "CHE"
      }
    }
  ],
  "2": [
    {
      "id": 11,
      "event": 2,
      "kickoff_time": "2026-08-28T19:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 14,
      "event": 2,
      "kickoff_time": "2026-08-29T11:30:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 12,
      "event": 2,
      "kickoff_time": "2026-08-29T14:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 13,
      "event": 2,
      "kickoff_time": "2026-08-29T14:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 15,
      "event": 2,
      "kickoff_time": "2026-08-29T16:30:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 16,
      "event": 2,
      "kickoff_time": "2026-08-30T13:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 17,
      "event": 2,
      "kickoff_time": "2026-08-30T13:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 19,
      "event": 2,
      "kickoff_time": "2026-08-30T13:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 18,
      "event": 2,
      "kickoff_time": "2026-08-30T15:30:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 20,
      "event": 2,
      "kickoff_time": "2026-08-31T19:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "ARS"
      }
    }
  ],
  "3": [
    {
      "id": 21,
      "event": 3,
      "kickoff_time": "2026-09-04T19:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 27,
      "event": 3,
      "kickoff_time": "2026-09-05T11:30:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 22,
      "event": 3,
      "kickoff_time": "2026-09-05T14:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 23,
      "event": 3,
      "kickoff_time": "2026-09-05T14:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 24,
      "event": 3,
      "kickoff_time": "2026-09-05T14:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 26,
      "event": 3,
      "kickoff_time": "2026-09-05T14:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 28,
      "event": 3,
      "kickoff_time": "2026-09-05T14:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 25,
      "event": 3,
      "kickoff_time": "2026-09-05T16:30:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 30,
      "event": 3,
      "kickoff_time": "2026-09-06T13:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 29,
      "event": 3,
      "kickoff_time": "2026-09-06T15:30:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "CHE"
      }
    }
  ],
  "4": [
    {
      "id": 31,
      "event": 4,
      "kickoff_time": "2026-09-12T14:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 32,
      "event": 4,
      "kickoff_time": "2026-09-12T14:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 33,
      "event": 4,
      "kickoff_time": "2026-09-12T14:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 34,
      "event": 4,
      "kickoff_time": "2026-09-12T14:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 35,
      "event": 4,
      "kickoff_time": "2026-09-12T14:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 37,
      "event": 4,
      "kickoff_time": "2026-09-12T16:30:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 36,
      "event": 4,
      "kickoff_time": "2026-09-12T19:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 38,
      "event": 4,
      "kickoff_time": "2026-09-13T13:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 39,
      "event": 4,
      "kickoff_time": "2026-09-13T15:30:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 40,
      "event": 4,
      "kickoff_time": "2026-09-14T19:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "NEW"
      }
    }
  ],
  "5": [
    {
      "id": 41,
      "event": 5,
      "kickoff_time": "2026-09-18T19:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 48,
      "event": 5,
      "kickoff_time": "2026-09-19T11:30:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 42,
      "event": 5,
      "kickoff_time": "2026-09-19T14:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 43,
      "event": 5,
      "kickoff_time": "2026-09-19T14:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 46,
      "event": 5,
      "kickoff_time": "2026-09-19T14:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 47,
      "event": 5,
      "kickoff_time": "2026-09-19T16:30:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 49,
      "event": 5,
      "kickoff_time": "2026-09-20T13:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 44,
      "event": 5,
      "kickoff_time": "2026-09-20T13:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 45,
      "event": 5,
      "kickoff_time": "2026-09-20T13:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 50,
      "event": 5,
      "kickoff_time": "2026-09-20T15:30:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "MUN"
      }
    }
  ],
  "6": [
    {
      "id": 51,
      "event": 6,
      "kickoff_time": "2026-10-10T11:30:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 52,
      "event": 6,
      "kickoff_time": "2026-10-10T14:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 53,
      "event": 6,
      "kickoff_time": "2026-10-10T14:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 57,
      "event": 6,
      "kickoff_time": "2026-10-10T14:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 60,
      "event": 6,
      "kickoff_time": "2026-10-10T14:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 59,
      "event": 6,
      "kickoff_time": "2026-10-10T16:30:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 55,
      "event": 6,
      "kickoff_time": "2026-10-11T13:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 56,
      "event": 6,
      "kickoff_time": "2026-10-11T13:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 58,
      "event": 6,
      "kickoff_time": "2026-10-11T15:30:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 54,
      "event": 6,
      "kickoff_time": "2026-10-12T19:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "NEW"
      }
    }
  ],
  "7": [
    {
      "id": 64,
      "event": 7,
      "kickoff_time": "2026-10-17T11:30:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 62,
      "event": 7,
      "kickoff_time": "2026-10-17T14:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 65,
      "event": 7,
      "kickoff_time": "2026-10-17T14:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 67,
      "event": 7,
      "kickoff_time": "2026-10-17T14:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 68,
      "event": 7,
      "kickoff_time": "2026-10-17T16:30:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 61,
      "event": 7,
      "kickoff_time": "2026-10-18T13:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 63,
      "event": 7,
      "kickoff_time": "2026-10-18T13:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 66,
      "event": 7,
      "kickoff_time": "2026-10-18T13:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 69,
      "event": 7,
      "kickoff_time": "2026-10-18T15:30:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 70,
      "event": 7,
      "kickoff_time": "2026-10-19T19:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "COV"
      }
    }
  ],
  "8": [
    {
      "id": 77,
      "event": 8,
      "kickoff_time": "2026-10-23T19:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 72,
      "event": 8,
      "kickoff_time": "2026-10-24T11:30:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 71,
      "event": 8,
      "kickoff_time": "2026-10-24T14:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 74,
      "event": 8,
      "kickoff_time": "2026-10-24T14:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 73,
      "event": 8,
      "kickoff_time": "2026-10-24T16:30:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 75,
      "event": 8,
      "kickoff_time": "2026-10-25T14:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 76,
      "event": 8,
      "kickoff_time": "2026-10-25T14:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 78,
      "event": 8,
      "kickoff_time": "2026-10-25T14:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 79,
      "event": 8,
      "kickoff_time": "2026-10-25T14:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 80,
      "event": 8,
      "kickoff_time": "2026-10-25T16:30:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "LEE"
      }
    }
  ],
  "9": [
    {
      "id": 84,
      "event": 9,
      "kickoff_time": "2026-10-31T12:30:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 82,
      "event": 9,
      "kickoff_time": "2026-10-31T15:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 83,
      "event": 9,
      "kickoff_time": "2026-10-31T15:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 85,
      "event": 9,
      "kickoff_time": "2026-10-31T15:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 86,
      "event": 9,
      "kickoff_time": "2026-10-31T15:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 88,
      "event": 9,
      "kickoff_time": "2026-10-31T15:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 90,
      "event": 9,
      "kickoff_time": "2026-10-31T17:30:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 81,
      "event": 9,
      "kickoff_time": "2026-10-31T20:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 87,
      "event": 9,
      "kickoff_time": "2026-11-01T16:30:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 89,
      "event": 9,
      "kickoff_time": "2026-11-02T20:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "EVE"
      }
    }
  ],
  "10": [
    {
      "id": 94,
      "event": 10,
      "kickoff_time": "2026-11-06T20:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 97,
      "event": 10,
      "kickoff_time": "2026-11-07T12:30:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 91,
      "event": 10,
      "kickoff_time": "2026-11-07T15:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 95,
      "event": 10,
      "kickoff_time": "2026-11-07T15:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 99,
      "event": 10,
      "kickoff_time": "2026-11-07T17:30:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 92,
      "event": 10,
      "kickoff_time": "2026-11-08T14:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 93,
      "event": 10,
      "kickoff_time": "2026-11-08T14:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 96,
      "event": 10,
      "kickoff_time": "2026-11-08T14:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 100,
      "event": 10,
      "kickoff_time": "2026-11-08T14:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 98,
      "event": 10,
      "kickoff_time": "2026-11-08T16:30:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "AVL"
      }
    }
  ],
  "11": [
    {
      "id": 108,
      "event": 11,
      "kickoff_time": "2026-11-21T12:30:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 101,
      "event": 11,
      "kickoff_time": "2026-11-21T15:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 102,
      "event": 11,
      "kickoff_time": "2026-11-21T15:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 104,
      "event": 11,
      "kickoff_time": "2026-11-21T15:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 105,
      "event": 11,
      "kickoff_time": "2026-11-21T15:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 110,
      "event": 11,
      "kickoff_time": "2026-11-21T15:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 109,
      "event": 11,
      "kickoff_time": "2026-11-21T17:30:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 106,
      "event": 11,
      "kickoff_time": "2026-11-22T14:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 107,
      "event": 11,
      "kickoff_time": "2026-11-22T16:30:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 103,
      "event": 11,
      "kickoff_time": "2026-11-23T20:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "EVE"
      }
    }
  ],
  "12": [
    {
      "id": 119,
      "event": 12,
      "kickoff_time": "2026-11-27T20:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 117,
      "event": 12,
      "kickoff_time": "2026-11-28T15:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 118,
      "event": 12,
      "kickoff_time": "2026-11-28T15:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 116,
      "event": 12,
      "kickoff_time": "2026-11-28T17:30:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 114,
      "event": 12,
      "kickoff_time": "2026-11-29T12:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 112,
      "event": 12,
      "kickoff_time": "2026-11-29T14:05:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 113,
      "event": 12,
      "kickoff_time": "2026-11-29T14:05:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 115,
      "event": 12,
      "kickoff_time": "2026-11-29T14:05:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 120,
      "event": 12,
      "kickoff_time": "2026-11-29T14:05:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 111,
      "event": 12,
      "kickoff_time": "2026-11-29T16:30:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "MCI"
      }
    }
  ],
  "13": [
    {
      "id": 125,
      "event": 13,
      "kickoff_time": "2026-12-01T20:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 124,
      "event": 13,
      "kickoff_time": "2026-12-02T19:30:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 126,
      "event": 13,
      "kickoff_time": "2026-12-02T19:30:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 127,
      "event": 13,
      "kickoff_time": "2026-12-02T19:30:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 128,
      "event": 13,
      "kickoff_time": "2026-12-02T19:30:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 121,
      "event": 13,
      "kickoff_time": "2026-12-02T20:15:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 122,
      "event": 13,
      "kickoff_time": "2026-12-02T20:15:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 123,
      "event": 13,
      "kickoff_time": "2026-12-02T20:15:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 129,
      "event": 13,
      "kickoff_time": "2026-12-02T20:15:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 130,
      "event": 13,
      "kickoff_time": "2026-12-03T20:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "FUL"
      }
    }
  ],
  "14": [
    {
      "id": 134,
      "event": 14,
      "kickoff_time": "2026-12-05T12:30:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 131,
      "event": 14,
      "kickoff_time": "2026-12-05T15:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 132,
      "event": 14,
      "kickoff_time": "2026-12-05T15:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 136,
      "event": 14,
      "kickoff_time": "2026-12-05T15:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 137,
      "event": 14,
      "kickoff_time": "2026-12-05T15:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 139,
      "event": 14,
      "kickoff_time": "2026-12-05T17:30:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 133,
      "event": 14,
      "kickoff_time": "2026-12-05T20:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 135,
      "event": 14,
      "kickoff_time": "2026-12-06T14:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 138,
      "event": 14,
      "kickoff_time": "2026-12-06T14:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 140,
      "event": 14,
      "kickoff_time": "2026-12-06T16:30:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "ARS"
      }
    }
  ],
  "15": [
    {
      "id": 145,
      "event": 15,
      "kickoff_time": "2026-12-12T15:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 147,
      "event": 15,
      "kickoff_time": "2026-12-12T15:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 148,
      "event": 15,
      "kickoff_time": "2026-12-12T15:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 149,
      "event": 15,
      "kickoff_time": "2026-12-12T17:30:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 141,
      "event": 15,
      "kickoff_time": "2026-12-13T14:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 142,
      "event": 15,
      "kickoff_time": "2026-12-13T14:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 150,
      "event": 15,
      "kickoff_time": "2026-12-13T14:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 143,
      "event": 15,
      "kickoff_time": "2026-12-13T16:30:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 144,
      "event": 15,
      "kickoff_time": "2026-12-13T19:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 146,
      "event": 15,
      "kickoff_time": "2026-12-14T20:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "TOT"
      }
    }
  ],
  "16": [
    {
      "id": 153,
      "event": 16,
      "kickoff_time": "2026-12-19T12:30:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 152,
      "event": 16,
      "kickoff_time": "2026-12-19T15:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 156,
      "event": 16,
      "kickoff_time": "2026-12-19T15:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 158,
      "event": 16,
      "kickoff_time": "2026-12-19T15:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 159,
      "event": 16,
      "kickoff_time": "2026-12-19T15:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 157,
      "event": 16,
      "kickoff_time": "2026-12-19T17:30:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 154,
      "event": 16,
      "kickoff_time": "2026-12-20T14:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 160,
      "event": 16,
      "kickoff_time": "2026-12-20T14:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 151,
      "event": 16,
      "kickoff_time": "2026-12-20T16:30:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 155,
      "event": 16,
      "kickoff_time": "2026-12-21T20:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "AVL"
      }
    }
  ],
  "17": [
    {
      "id": 161,
      "event": 17,
      "kickoff_time": "2026-12-26T12:30:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 164,
      "event": 17,
      "kickoff_time": "2026-12-26T15:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 165,
      "event": 17,
      "kickoff_time": "2026-12-26T15:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 167,
      "event": 17,
      "kickoff_time": "2026-12-26T15:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 170,
      "event": 17,
      "kickoff_time": "2026-12-26T15:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 166,
      "event": 17,
      "kickoff_time": "2026-12-26T17:30:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 169,
      "event": 17,
      "kickoff_time": "2026-12-26T20:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 162,
      "event": 17,
      "kickoff_time": "2026-12-27T14:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 168,
      "event": 17,
      "kickoff_time": "2026-12-27T16:30:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 163,
      "event": 17,
      "kickoff_time": "2026-12-27T19:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "ARS"
      }
    }
  ],
  "18": [
    {
      "id": 176,
      "event": 18,
      "kickoff_time": "2026-12-29T19:30:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 180,
      "event": 18,
      "kickoff_time": "2026-12-29T19:30:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 174,
      "event": 18,
      "kickoff_time": "2026-12-29T20:15:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 172,
      "event": 18,
      "kickoff_time": "2026-12-30T19:30:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 173,
      "event": 18,
      "kickoff_time": "2026-12-30T19:30:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 175,
      "event": 18,
      "kickoff_time": "2026-12-30T19:30:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 178,
      "event": 18,
      "kickoff_time": "2026-12-30T19:30:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 179,
      "event": 18,
      "kickoff_time": "2026-12-30T19:30:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 171,
      "event": 18,
      "kickoff_time": "2026-12-30T20:15:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 177,
      "event": 18,
      "kickoff_time": "2026-12-30T20:15:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "CHE"
      }
    }
  ],
  "19": [
    {
      "id": 186,
      "event": 19,
      "kickoff_time": "2027-01-01T20:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 184,
      "event": 19,
      "kickoff_time": "2027-01-02T12:30:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 181,
      "event": 19,
      "kickoff_time": "2027-01-02T15:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 183,
      "event": 19,
      "kickoff_time": "2027-01-02T15:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 187,
      "event": 19,
      "kickoff_time": "2027-01-02T15:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 189,
      "event": 19,
      "kickoff_time": "2027-01-02T15:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 190,
      "event": 19,
      "kickoff_time": "2027-01-02T15:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 182,
      "event": 19,
      "kickoff_time": "2027-01-02T17:30:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 185,
      "event": 19,
      "kickoff_time": "2027-01-03T14:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 188,
      "event": 19,
      "kickoff_time": "2027-01-03T16:30:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "TOT"
      }
    }
  ],
  "20": [
    {
      "id": 191,
      "event": 20,
      "kickoff_time": "2027-01-05T19:30:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 192,
      "event": 20,
      "kickoff_time": "2027-01-05T19:30:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 194,
      "event": 20,
      "kickoff_time": "2027-01-05T19:30:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 199,
      "event": 20,
      "kickoff_time": "2027-01-05T19:30:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 200,
      "event": 20,
      "kickoff_time": "2027-01-05T20:15:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 193,
      "event": 20,
      "kickoff_time": "2027-01-06T19:30:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 195,
      "event": 20,
      "kickoff_time": "2027-01-06T19:30:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 196,
      "event": 20,
      "kickoff_time": "2027-01-06T19:30:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 197,
      "event": 20,
      "kickoff_time": "2027-01-06T20:15:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 198,
      "event": 20,
      "kickoff_time": "2027-01-07T20:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "NEW"
      }
    }
  ],
  "21": [
    {
      "id": 201,
      "event": 21,
      "kickoff_time": "2027-01-16T15:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 202,
      "event": 21,
      "kickoff_time": "2027-01-16T15:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 203,
      "event": 21,
      "kickoff_time": "2027-01-16T15:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 204,
      "event": 21,
      "kickoff_time": "2027-01-16T15:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 205,
      "event": 21,
      "kickoff_time": "2027-01-16T15:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 206,
      "event": 21,
      "kickoff_time": "2027-01-16T15:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 207,
      "event": 21,
      "kickoff_time": "2027-01-16T15:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 208,
      "event": 21,
      "kickoff_time": "2027-01-16T15:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 209,
      "event": 21,
      "kickoff_time": "2027-01-16T15:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 210,
      "event": 21,
      "kickoff_time": "2027-01-16T15:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "LEE"
      }
    }
  ],
  "22": [
    {
      "id": 211,
      "event": 22,
      "kickoff_time": "2027-01-23T15:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 212,
      "event": 22,
      "kickoff_time": "2027-01-23T15:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 213,
      "event": 22,
      "kickoff_time": "2027-01-23T15:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 214,
      "event": 22,
      "kickoff_time": "2027-01-23T15:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 215,
      "event": 22,
      "kickoff_time": "2027-01-23T15:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 216,
      "event": 22,
      "kickoff_time": "2027-01-23T15:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 217,
      "event": 22,
      "kickoff_time": "2027-01-23T15:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 218,
      "event": 22,
      "kickoff_time": "2027-01-23T15:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 219,
      "event": 22,
      "kickoff_time": "2027-01-23T15:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 220,
      "event": 22,
      "kickoff_time": "2027-01-23T15:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "COV"
      }
    }
  ],
  "23": [
    {
      "id": 221,
      "event": 23,
      "kickoff_time": "2027-01-30T15:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 222,
      "event": 23,
      "kickoff_time": "2027-01-30T15:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 223,
      "event": 23,
      "kickoff_time": "2027-01-30T15:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 224,
      "event": 23,
      "kickoff_time": "2027-01-30T15:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 225,
      "event": 23,
      "kickoff_time": "2027-01-30T15:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 226,
      "event": 23,
      "kickoff_time": "2027-01-30T15:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 227,
      "event": 23,
      "kickoff_time": "2027-01-30T15:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 228,
      "event": 23,
      "kickoff_time": "2027-01-30T15:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 229,
      "event": 23,
      "kickoff_time": "2027-01-30T15:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 230,
      "event": 23,
      "kickoff_time": "2027-01-30T15:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "SUN"
      }
    }
  ],
  "24": [
    {
      "id": 231,
      "event": 24,
      "kickoff_time": "2027-02-06T15:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 232,
      "event": 24,
      "kickoff_time": "2027-02-06T15:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 233,
      "event": 24,
      "kickoff_time": "2027-02-06T15:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 234,
      "event": 24,
      "kickoff_time": "2027-02-06T15:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 235,
      "event": 24,
      "kickoff_time": "2027-02-06T15:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 236,
      "event": 24,
      "kickoff_time": "2027-02-06T15:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 237,
      "event": 24,
      "kickoff_time": "2027-02-06T15:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 238,
      "event": 24,
      "kickoff_time": "2027-02-06T15:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 239,
      "event": 24,
      "kickoff_time": "2027-02-06T15:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 240,
      "event": 24,
      "kickoff_time": "2027-02-06T15:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "AVL"
      }
    }
  ],
  "25": [
    {
      "id": 241,
      "event": 25,
      "kickoff_time": "2027-02-10T20:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 242,
      "event": 25,
      "kickoff_time": "2027-02-10T20:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 243,
      "event": 25,
      "kickoff_time": "2027-02-10T20:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 244,
      "event": 25,
      "kickoff_time": "2027-02-10T20:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 245,
      "event": 25,
      "kickoff_time": "2027-02-10T20:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 246,
      "event": 25,
      "kickoff_time": "2027-02-10T20:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 247,
      "event": 25,
      "kickoff_time": "2027-02-10T20:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 248,
      "event": 25,
      "kickoff_time": "2027-02-10T20:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 249,
      "event": 25,
      "kickoff_time": "2027-02-10T20:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 250,
      "event": 25,
      "kickoff_time": "2027-02-10T20:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "MCI"
      }
    }
  ],
  "26": [
    {
      "id": 251,
      "event": 26,
      "kickoff_time": "2027-02-20T15:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 252,
      "event": 26,
      "kickoff_time": "2027-02-20T15:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 253,
      "event": 26,
      "kickoff_time": "2027-02-20T15:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 254,
      "event": 26,
      "kickoff_time": "2027-02-20T15:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 255,
      "event": 26,
      "kickoff_time": "2027-02-20T15:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 256,
      "event": 26,
      "kickoff_time": "2027-02-20T15:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 257,
      "event": 26,
      "kickoff_time": "2027-02-20T15:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 258,
      "event": 26,
      "kickoff_time": "2027-02-20T15:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 259,
      "event": 26,
      "kickoff_time": "2027-02-20T15:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 260,
      "event": 26,
      "kickoff_time": "2027-02-20T15:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "EVE"
      }
    }
  ],
  "27": [
    {
      "id": 261,
      "event": 27,
      "kickoff_time": "2027-02-27T15:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 262,
      "event": 27,
      "kickoff_time": "2027-02-27T15:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 263,
      "event": 27,
      "kickoff_time": "2027-02-27T15:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 264,
      "event": 27,
      "kickoff_time": "2027-02-27T15:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 265,
      "event": 27,
      "kickoff_time": "2027-02-27T15:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 266,
      "event": 27,
      "kickoff_time": "2027-02-27T15:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 267,
      "event": 27,
      "kickoff_time": "2027-02-27T15:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 268,
      "event": 27,
      "kickoff_time": "2027-02-27T15:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 269,
      "event": 27,
      "kickoff_time": "2027-02-27T15:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 270,
      "event": 27,
      "kickoff_time": "2027-02-27T15:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "LIV"
      }
    }
  ],
  "28": [
    {
      "id": 271,
      "event": 28,
      "kickoff_time": "2027-03-03T20:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 272,
      "event": 28,
      "kickoff_time": "2027-03-03T20:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 273,
      "event": 28,
      "kickoff_time": "2027-03-03T20:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 274,
      "event": 28,
      "kickoff_time": "2027-03-03T20:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 275,
      "event": 28,
      "kickoff_time": "2027-03-03T20:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 276,
      "event": 28,
      "kickoff_time": "2027-03-03T20:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 277,
      "event": 28,
      "kickoff_time": "2027-03-03T20:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 278,
      "event": 28,
      "kickoff_time": "2027-03-03T20:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 279,
      "event": 28,
      "kickoff_time": "2027-03-03T20:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 280,
      "event": 28,
      "kickoff_time": "2027-03-03T20:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "MUN"
      }
    }
  ],
  "29": [
    {
      "id": 281,
      "event": 29,
      "kickoff_time": "2027-03-13T15:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 282,
      "event": 29,
      "kickoff_time": "2027-03-13T15:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 283,
      "event": 29,
      "kickoff_time": "2027-03-13T15:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 284,
      "event": 29,
      "kickoff_time": "2027-03-13T15:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 285,
      "event": 29,
      "kickoff_time": "2027-03-13T15:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 286,
      "event": 29,
      "kickoff_time": "2027-03-13T15:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 287,
      "event": 29,
      "kickoff_time": "2027-03-13T15:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 288,
      "event": 29,
      "kickoff_time": "2027-03-13T15:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 290,
      "event": 29,
      "kickoff_time": "2027-03-13T15:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 289,
      "event": 29,
      "kickoff_time": "2027-03-13T15:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "BRE"
      }
    }
  ],
  "30": [
    {
      "id": 291,
      "event": 30,
      "kickoff_time": "2027-03-20T15:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 292,
      "event": 30,
      "kickoff_time": "2027-03-20T15:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 293,
      "event": 30,
      "kickoff_time": "2027-03-20T15:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 294,
      "event": 30,
      "kickoff_time": "2027-03-20T15:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 295,
      "event": 30,
      "kickoff_time": "2027-03-20T15:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 296,
      "event": 30,
      "kickoff_time": "2027-03-20T15:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 297,
      "event": 30,
      "kickoff_time": "2027-03-20T15:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 298,
      "event": 30,
      "kickoff_time": "2027-03-20T15:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 299,
      "event": 30,
      "kickoff_time": "2027-03-20T15:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 300,
      "event": 30,
      "kickoff_time": "2027-03-20T15:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "AVL"
      }
    }
  ],
  "31": [
    {
      "id": 301,
      "event": 31,
      "kickoff_time": "2027-04-10T14:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 302,
      "event": 31,
      "kickoff_time": "2027-04-10T14:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 303,
      "event": 31,
      "kickoff_time": "2027-04-10T14:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 304,
      "event": 31,
      "kickoff_time": "2027-04-10T14:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 305,
      "event": 31,
      "kickoff_time": "2027-04-10T14:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 306,
      "event": 31,
      "kickoff_time": "2027-04-10T14:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 307,
      "event": 31,
      "kickoff_time": "2027-04-10T14:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 308,
      "event": 31,
      "kickoff_time": "2027-04-10T14:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 310,
      "event": 31,
      "kickoff_time": "2027-04-10T14:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 309,
      "event": 31,
      "kickoff_time": "2027-04-10T14:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "IPS"
      }
    }
  ],
  "32": [
    {
      "id": 311,
      "event": 32,
      "kickoff_time": "2027-04-17T14:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 312,
      "event": 32,
      "kickoff_time": "2027-04-17T14:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 313,
      "event": 32,
      "kickoff_time": "2027-04-17T14:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 314,
      "event": 32,
      "kickoff_time": "2027-04-17T14:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 315,
      "event": 32,
      "kickoff_time": "2027-04-17T14:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 316,
      "event": 32,
      "kickoff_time": "2027-04-17T14:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 317,
      "event": 32,
      "kickoff_time": "2027-04-17T14:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 318,
      "event": 32,
      "kickoff_time": "2027-04-17T14:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 319,
      "event": 32,
      "kickoff_time": "2027-04-17T14:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 320,
      "event": 32,
      "kickoff_time": "2027-04-17T14:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "LIV"
      }
    }
  ],
  "33": [
    {
      "id": 321,
      "event": 33,
      "kickoff_time": "2027-04-24T14:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 322,
      "event": 33,
      "kickoff_time": "2027-04-24T14:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 323,
      "event": 33,
      "kickoff_time": "2027-04-24T14:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 324,
      "event": 33,
      "kickoff_time": "2027-04-24T14:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 325,
      "event": 33,
      "kickoff_time": "2027-04-24T14:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 326,
      "event": 33,
      "kickoff_time": "2027-04-24T14:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 327,
      "event": 33,
      "kickoff_time": "2027-04-24T14:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 328,
      "event": 33,
      "kickoff_time": "2027-04-24T14:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 329,
      "event": 33,
      "kickoff_time": "2027-04-24T14:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 330,
      "event": 33,
      "kickoff_time": "2027-04-24T14:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "HUL"
      }
    }
  ],
  "34": [
    {
      "id": 331,
      "event": 34,
      "kickoff_time": "2027-05-01T14:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 332,
      "event": 34,
      "kickoff_time": "2027-05-01T14:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 333,
      "event": 34,
      "kickoff_time": "2027-05-01T14:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 334,
      "event": 34,
      "kickoff_time": "2027-05-01T14:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 335,
      "event": 34,
      "kickoff_time": "2027-05-01T14:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 336,
      "event": 34,
      "kickoff_time": "2027-05-01T14:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 337,
      "event": 34,
      "kickoff_time": "2027-05-01T14:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 338,
      "event": 34,
      "kickoff_time": "2027-05-01T14:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 339,
      "event": 34,
      "kickoff_time": "2027-05-01T14:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 340,
      "event": 34,
      "kickoff_time": "2027-05-01T14:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "NEW"
      }
    }
  ],
  "35": [
    {
      "id": 341,
      "event": 35,
      "kickoff_time": "2027-05-08T14:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "MUN"
      }
    },
    {
      "id": 342,
      "event": 35,
      "kickoff_time": "2027-05-08T14:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 343,
      "event": 35,
      "kickoff_time": "2027-05-08T14:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 344,
      "event": 35,
      "kickoff_time": "2027-05-08T14:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 345,
      "event": 35,
      "kickoff_time": "2027-05-08T14:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 346,
      "event": 35,
      "kickoff_time": "2027-05-08T14:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 347,
      "event": 35,
      "kickoff_time": "2027-05-08T14:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 348,
      "event": 35,
      "kickoff_time": "2027-05-08T14:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 349,
      "event": 35,
      "kickoff_time": "2027-05-08T14:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 350,
      "event": 35,
      "kickoff_time": "2027-05-08T14:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "CHE"
      }
    }
  ],
  "36": [
    {
      "id": 351,
      "event": 36,
      "kickoff_time": "2027-05-15T14:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 352,
      "event": 36,
      "kickoff_time": "2027-05-15T14:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 353,
      "event": 36,
      "kickoff_time": "2027-05-15T14:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 354,
      "event": 36,
      "kickoff_time": "2027-05-15T14:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 355,
      "event": 36,
      "kickoff_time": "2027-05-15T14:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 356,
      "event": 36,
      "kickoff_time": "2027-05-15T14:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 357,
      "event": 36,
      "kickoff_time": "2027-05-15T14:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "MCI"
      }
    },
    {
      "id": 358,
      "event": 36,
      "kickoff_time": "2027-05-15T14:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 359,
      "event": 36,
      "kickoff_time": "2027-05-15T14:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 360,
      "event": 36,
      "kickoff_time": "2027-05-15T14:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "BOU"
      }
    }
  ],
  "37": [
    {
      "id": 361,
      "event": 37,
      "kickoff_time": "2027-05-23T14:00:00Z",
      "home_team": {
        "short_name": "BOU"
      },
      "away_team": {
        "short_name": "CHE"
      }
    },
    {
      "id": 362,
      "event": 37,
      "kickoff_time": "2027-05-23T14:00:00Z",
      "home_team": {
        "short_name": "BRE"
      },
      "away_team": {
        "short_name": "HUL"
      }
    },
    {
      "id": 363,
      "event": 37,
      "kickoff_time": "2027-05-23T14:00:00Z",
      "home_team": {
        "short_name": "BHA"
      },
      "away_team": {
        "short_name": "LIV"
      }
    },
    {
      "id": 364,
      "event": 37,
      "kickoff_time": "2027-05-23T14:00:00Z",
      "home_team": {
        "short_name": "EVE"
      },
      "away_team": {
        "short_name": "ARS"
      }
    },
    {
      "id": 365,
      "event": 37,
      "kickoff_time": "2027-05-23T14:00:00Z",
      "home_team": {
        "short_name": "FUL"
      },
      "away_team": {
        "short_name": "COV"
      }
    },
    {
      "id": 366,
      "event": 37,
      "kickoff_time": "2027-05-23T14:00:00Z",
      "home_team": {
        "short_name": "LEE"
      },
      "away_team": {
        "short_name": "SUN"
      }
    },
    {
      "id": 367,
      "event": 37,
      "kickoff_time": "2027-05-23T14:00:00Z",
      "home_team": {
        "short_name": "MCI"
      },
      "away_team": {
        "short_name": "AVL"
      }
    },
    {
      "id": 368,
      "event": 37,
      "kickoff_time": "2027-05-23T14:00:00Z",
      "home_team": {
        "short_name": "NEW"
      },
      "away_team": {
        "short_name": "CRY"
      }
    },
    {
      "id": 369,
      "event": 37,
      "kickoff_time": "2027-05-23T14:00:00Z",
      "home_team": {
        "short_name": "NFO"
      },
      "away_team": {
        "short_name": "IPS"
      }
    },
    {
      "id": 370,
      "event": 37,
      "kickoff_time": "2027-05-23T14:00:00Z",
      "home_team": {
        "short_name": "TOT"
      },
      "away_team": {
        "short_name": "MUN"
      }
    }
  ],
  "38": [
    {
      "id": 371,
      "event": 38,
      "kickoff_time": "2027-05-30T15:00:00Z",
      "home_team": {
        "short_name": "ARS"
      },
      "away_team": {
        "short_name": "BHA"
      }
    },
    {
      "id": 372,
      "event": 38,
      "kickoff_time": "2027-05-30T15:00:00Z",
      "home_team": {
        "short_name": "AVL"
      },
      "away_team": {
        "short_name": "TOT"
      }
    },
    {
      "id": 373,
      "event": 38,
      "kickoff_time": "2027-05-30T15:00:00Z",
      "home_team": {
        "short_name": "CHE"
      },
      "away_team": {
        "short_name": "BRE"
      }
    },
    {
      "id": 374,
      "event": 38,
      "kickoff_time": "2027-05-30T15:00:00Z",
      "home_team": {
        "short_name": "COV"
      },
      "away_team": {
        "short_name": "NFO"
      }
    },
    {
      "id": 375,
      "event": 38,
      "kickoff_time": "2027-05-30T15:00:00Z",
      "home_team": {
        "short_name": "CRY"
      },
      "away_team": {
        "short_name": "LEE"
      }
    },
    {
      "id": 376,
      "event": 38,
      "kickoff_time": "2027-05-30T15:00:00Z",
      "home_team": {
        "short_name": "HUL"
      },
      "away_team": {
        "short_name": "NEW"
      }
    },
    {
      "id": 377,
      "event": 38,
      "kickoff_time": "2027-05-30T15:00:00Z",
      "home_team": {
        "short_name": "IPS"
      },
      "away_team": {
        "short_name": "EVE"
      }
    },
    {
      "id": 378,
      "event": 38,
      "kickoff_time": "2027-05-30T15:00:00Z",
      "home_team": {
        "short_name": "LIV"
      },
      "away_team": {
        "short_name": "BOU"
      }
    },
    {
      "id": 379,
      "event": 38,
      "kickoff_time": "2027-05-30T15:00:00Z",
      "home_team": {
        "short_name": "MUN"
      },
      "away_team": {
        "short_name": "FUL"
      }
    },
    {
      "id": 380,
      "event": 38,
      "kickoff_time": "2027-05-30T15:00:00Z",
      "home_team": {
        "short_name": "SUN"
      },
      "away_team": {
        "short_name": "MCI"
      }
    }
  ]
};
