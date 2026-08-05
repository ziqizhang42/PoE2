CREATE TYPE "public"."game_status" AS ENUM('waiting', 'active', 'finished');--> statement-breakpoint
CREATE TABLE "game_moves" (
	"game_id" uuid NOT NULL,
	"ply" smallint NOT NULL,
	"row" smallint NOT NULL,
	"col" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_moves_game_id_ply_pk" PRIMARY KEY("game_id","ply"),
	CONSTRAINT "game_moves_ply_range" CHECK ("game_moves"."ply" >= 0 and "game_moves"."ply" < 49),
	CONSTRAINT "game_moves_row_range" CHECK ("game_moves"."row" >= 0 and "game_moves"."row" < 7),
	CONSTRAINT "game_moves_col_range" CHECK ("game_moves"."col" >= 0 and "game_moves"."col" < 7)
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_one_id" uuid NOT NULL,
	"player_two_id" uuid,
	"status" "game_status" DEFAULT 'waiting' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_revision_non_negative" CHECK ("games"."revision" >= 0),
	CONSTRAINT "games_players_distinct" CHECK ("games"."player_two_id" is null or "games"."player_two_id" <> "games"."player_one_id"),
	CONSTRAINT "games_second_seat_matches_status" CHECK (("games"."status" = 'waiting') = ("games"."player_two_id" is null))
);
--> statement-breakpoint
ALTER TABLE "game_moves" ADD CONSTRAINT "game_moves_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_player_one_id_users_id_fk" FOREIGN KEY ("player_one_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_player_two_id_users_id_fk" FOREIGN KEY ("player_two_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_moves_square_unique" ON "game_moves" USING btree ("game_id","row","col");--> statement-breakpoint
CREATE INDEX "games_status_created_at_index" ON "games" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "games_player_one_id_index" ON "games" USING btree ("player_one_id");--> statement-breakpoint
CREATE INDEX "games_player_two_id_index" ON "games" USING btree ("player_two_id");