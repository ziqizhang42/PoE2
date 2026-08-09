CREATE TYPE "public"."game_outcome_reason" AS ENUM('board_full', 'resignation', 'timeout');--> statement-breakpoint
ALTER TYPE "public"."game_status" ADD VALUE 'ready_check' BEFORE 'active';--> statement-breakpoint
CREATE TABLE "game_move_clocks" (
	"game_id" uuid NOT NULL,
	"ply" smallint NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"increment_applied_ms" integer NOT NULL,
	"player_one_remaining_ms" integer NOT NULL,
	"player_two_remaining_ms" integer NOT NULL,
	CONSTRAINT "game_move_clocks_game_id_ply_pk" PRIMARY KEY("game_id","ply"),
	CONSTRAINT "game_move_clocks_elapsed_non_negative" CHECK ("game_move_clocks"."elapsed_ms" >= 0),
	CONSTRAINT "game_move_clocks_increment_non_negative" CHECK ("game_move_clocks"."increment_applied_ms" >= 0),
	CONSTRAINT "game_move_clocks_balances_non_negative" CHECK ("game_move_clocks"."player_one_remaining_ms" >= 0 and "game_move_clocks"."player_two_remaining_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rating_events" (
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"opponent_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"rating_before" double precision NOT NULL,
	"rating_deviation_before" double precision NOT NULL,
	"volatility_before" double precision NOT NULL,
	"rating_after" double precision NOT NULL,
	"rating_deviation_after" double precision NOT NULL,
	"volatility_after" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_events_game_id_user_id_pk" PRIMARY KEY("game_id","user_id"),
	CONSTRAINT "rating_events_score_is_a_result" CHECK ("rating_events"."score" in (0, 1)),
	CONSTRAINT "rating_events_players_distinct" CHECK ("rating_events"."user_id" <> "rating_events"."opponent_id")
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "rated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "creator_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "creator_seat" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "player_one_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "player_two_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "ready_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "ready_check_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "activated_revision" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "initial_time_ms" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "increment_ms" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "player_one_remaining_ms" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "player_two_remaining_ms" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "running_player" smallint;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "turn_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "clock_stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "finished_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "outcome_reason" "game_outcome_reason";--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "winner" smallint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rating" double precision DEFAULT 1500 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rating_deviation" double precision DEFAULT 350 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "volatility" double precision DEFAULT 0.06 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rated_games_played" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rating_period_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "game_move_clocks" ADD CONSTRAINT "game_move_clocks_move_fk" FOREIGN KEY ("game_id","ply") REFERENCES "public"."game_moves"("game_id","ply") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_events" ADD CONSTRAINT "rating_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_events" ADD CONSTRAINT "rating_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_events" ADD CONSTRAINT "rating_events_opponent_id_users_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rating_events_user_created_at_index" ON "rating_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_creator_id_index" ON "games" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_one_waiting_lobby_per_owner" ON "games" USING btree ("creator_id") WHERE "games"."status" <> 'active' and "games"."status" <> 'finished';--> statement-breakpoint
CREATE INDEX "games_player_one_history_index" ON "games" USING btree ("player_one_id","finished_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "games"."status" = 'finished';--> statement-breakpoint
CREATE INDEX "games_player_two_history_index" ON "games" USING btree ("player_two_id","finished_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "games"."status" = 'finished';--> statement-breakpoint
CREATE INDEX "games_active_deadline_index" ON "games" USING btree ("deadline_at","id") WHERE "games"."status" = 'active' and "games"."deadline_at" is not null;--> statement-breakpoint
CREATE INDEX "games_ready_deadline_index" ON "games" USING btree ("ready_deadline_at","id") WHERE "games"."ready_deadline_at" is not null;--> statement-breakpoint
CREATE INDEX "users_rating_period_index" ON "users" USING btree ("rating_period_at") WHERE "users"."rated_games_played" > 0;--> statement-breakpoint
CREATE INDEX "users_rated_rating_index" ON "users" USING btree ("rating") WHERE "users"."rated_games_played" > 0;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_winner_is_a_seat" CHECK ("games"."winner" is null or "games"."winner" in (1, 2));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_creator_seat_is_a_seat" CHECK ("games"."creator_seat" in (1, 2));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_creator_holds_their_seat" CHECK ("games"."creator_id" = case when "games"."player_two_id" is null or "games"."creator_seat" = 1 then "games"."player_one_id" else "games"."player_two_id" end);--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_outcome_matches_status" CHECK (("games"."status" = 'finished') = ("games"."finished_at" is not null and "games"."outcome_reason" is not null and "games"."winner" is not null));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_time_control_configuration" CHECK (("games"."initial_time_ms" is null and "games"."increment_ms" is null)
        or ("games"."initial_time_ms" is not null
          and "games"."initial_time_ms" >= 10000
          and "games"."initial_time_ms" <= 10800000
          and mod("games"."initial_time_ms", 1000) = 0
          and "games"."increment_ms" is not null
          and "games"."increment_ms" >= 0
          and "games"."increment_ms" <= 180000
          and mod("games"."increment_ms", 1000) = 0));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_ready_check_state" CHECK (("games"."status"::text = 'ready_check') = ("games"."ready_deadline_at" is not null)
        and ("games"."status"::text = 'ready_check' or (not "games"."player_one_ready" and not "games"."player_two_ready"))
        and not ("games"."player_one_ready" and "games"."player_two_ready"));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_ready_check_generation" CHECK ("games"."ready_check_generation" >= 0
        and ("games"."status"::text <> 'ready_check' or "games"."ready_check_generation" > 0));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_activated_revision" CHECK (("games"."status" in ('active', 'finished')) = ("games"."activated_revision" is not null)
        and ("games"."activated_revision" is null or "games"."activated_revision" <= "games"."revision"));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_rated_requires_clock" CHECK (not ("games"."rated" and "games"."initial_time_ms" is null));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_clock_state" CHECK (
        ("games"."initial_time_ms" is null
          and "games"."player_one_remaining_ms" is null
          and "games"."player_two_remaining_ms" is null
          and "games"."running_player" is null
          and "games"."turn_started_at" is null
          and "games"."deadline_at" is null
          and "games"."clock_stopped_at" is null)
        or
        ("games"."initial_time_ms" is not null and (
          ("games"."status"::text in ('waiting', 'ready_check')
            and "games"."player_one_remaining_ms" is null
            and "games"."player_two_remaining_ms" is null
            and "games"."running_player" is null
            and "games"."turn_started_at" is null
            and "games"."deadline_at" is null
            and "games"."clock_stopped_at" is null)
          or
          ("games"."status" = 'active'
            and "games"."player_one_remaining_ms" is not null
            and "games"."player_one_remaining_ms" > 0
            and "games"."player_two_remaining_ms" is not null
            and "games"."player_two_remaining_ms" > 0
            and "games"."running_player" is not null
            and "games"."running_player" in (1, 2)
            and "games"."running_player" = case when mod("games"."revision" - "games"."activated_revision", 2) = 0 then 1 else 2 end
            and "games"."turn_started_at" is not null
            and "games"."deadline_at" is not null
            and "games"."deadline_at" = "games"."turn_started_at" +
              (case when "games"."running_player" = 1 then "games"."player_one_remaining_ms" else "games"."player_two_remaining_ms" end) * interval '1 millisecond'
            and "games"."clock_stopped_at" is null)
          or
          ("games"."status" = 'finished'
            and "games"."player_one_remaining_ms" is not null
            and "games"."player_one_remaining_ms" >= 0
            and "games"."player_two_remaining_ms" is not null
            and "games"."player_two_remaining_ms" >= 0
            and "games"."running_player" is null
            and "games"."turn_started_at" is null
            and "games"."deadline_at" is null
            and "games"."clock_stopped_at" is not null)
        )));--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_timeout_clock" CHECK ("games"."outcome_reason" is distinct from 'timeout' or ("games"."initial_time_ms" is not null and (("games"."winner" = 1 and "games"."player_two_remaining_ms" = 0) or ("games"."winner" = 2 and "games"."player_one_remaining_ms" = 0))));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_rating_deviation_positive" CHECK ("users"."rating_deviation" > 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_volatility_positive" CHECK ("users"."volatility" > 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_rated_games_played_not_negative" CHECK ("users"."rated_games_played" >= 0);