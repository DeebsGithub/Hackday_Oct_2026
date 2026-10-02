from snowflake import connector
from dotenv import load_dotenv
import os
from dataclasses import dataclass
from datetime import date, datetime

load_dotenv()


@dataclass
class FlightRequest:
    departing_airport: str
    arriving_airport: str
    departure_date: date


def is_delayed_or_canceled(row):
    return row[1] or row[0] > 0


def load_database(request: FlightRequest):
    conn = connector.connect(
        account=os.environ['SNOWFLAKE_ACCOUNT'],
        user=os.environ['SNOWFLAKE_USER'],
        password=os.environ['SNOWFLAKE_PASSWORD'],
        role=os.environ["SNOWFLAKE_ROLE"],
        warehouse=os.environ["SNOWFLAKE_WAREHOUSE"],
        database="CIRIUM_FLIGHT_DATA",
        schema="PUBLIC"
    )

    sql_req = f"""
    SELECT
    GATE_DEPARTURE_DELAY,
    IS_CANCELLED
    FROM FLIGHTS
    WHERE DEPARTURE_AIRPORT_ID = '{request.departing_airport}'
    AND ARRIVAL_AIRPORT_ID = '{request.arriving_airport}';
    """

    cur = conn.cursor()
    cur.execute(sql_req)
    rows = cur.fetchall()

    print(rows)

    if len(rows) == 0:
        raise Exception("No data found")

    base_percent_delayed_or_canceled = \
        sum(1 for row in rows if is_delayed_or_canceled(row)) / len(rows)

    print(f"{base_percent_delayed_or_canceled=}")

    return base_percent_delayed_or_canceled


if __name__ == "__main__":
    request = FlightRequest(
        departing_airport="PHX",
        arriving_airport="LAX",
        departure_date=datetime.strptime("10/4/2026", "%m/%d/%Y").date(),
    )
    load_database(request)
