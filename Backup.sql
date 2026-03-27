--
-- PostgreSQL database dump
--

\restrict 8AnzSMXOh88HaI4ILKO2WufuzCrUQOjNGg8GzP0xNbKklojeuXhMmdy5t7ZepME

-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

-- Started on 2026-02-23 15:06:35

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 228 (class 1259 OID 18315)
-- Name: invoice_concepts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_concepts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoice_concepts_id_seq OWNER TO postgres;

--
-- TOC entry 230 (class 1259 OID 18327)
-- Name: invoice_related_cfdis_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_related_cfdis_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoice_related_cfdis_id_seq OWNER TO postgres;

--
-- TOC entry 3559 (class 0 OID 0)
-- Dependencies: 228
-- Name: invoice_concepts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.invoice_concepts_id_seq', 42, true);


--
-- TOC entry 3560 (class 0 OID 0)
-- Dependencies: 230
-- Name: invoice_related_cfdis_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.invoice_related_cfdis_id_seq', 1, false);


-- Completed on 2026-02-23 15:06:35

--
-- PostgreSQL database dump complete
--

\unrestrict 8AnzSMXOh88HaI4ILKO2WufuzCrUQOjNGg8GzP0xNbKklojeuXhMmdy5t7ZepME

